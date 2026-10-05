import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from django.conf import settings
from django.db import close_old_connections
from django.db.models import Q
from django.utils import timezone, translation
from django.utils.translation import gettext as _
import requests
from pywebpush import WebPushException, webpush

from .models import PushSubscription
from .vapid import get_signer

log = logging.getLogger(__name__)
# عدد ثابت من العمال للإشعارات: لو انرسلت 2000 رسالة سوه ما نفتح 2000 thread،
# تنتظر بالطابور وتنرسل بالتسلسل بدون ما تبطئ الرسائل نفسها
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix='push')
# خدمة إشعارات لا ترد (Apple أو Google): بدون مهلة يبقى العامل ينتظرها للأبد، فتتأخر كل الإشعارات بعدها في الطابور
PUSH_TIMEOUT = 10
_local = threading.local()


def _session():
    """اتصال مفتوح لكل عامل يُعاد استعماله: بدل مصافحة TLS جديدة مع خادم Apple/Google لكل إشعار (أسرع بعشرات الأجزاء من الثانية)."""
    if not hasattr(_local, 'session'):
        _local.session = requests.Session()
    return _local.session


def notify_new_message(message, preview=None, mentioned=()):
    """
    نرسل إشعاراً لكل عضو في المحادثة عدا المرسل (ومن كتمها)، على كل أجهزته.
    preview(tr) تعيد النص المختصر مترجماً، فكل مستلم يصله الإشعار بلغته.
    """
    sender = message.sender
    profile = getattr(sender, 'profile', None)
    sender_name = (profile.display_name if profile and profile.display_name else sender.username)
    conv = message.conversation
    if conv.kind == 'saved':
        return
    from chat.models import Membership
    # من كتمها: دائماً، أو حتى وقت لم يأتِ بعد (بعده يعود الإشعار وحده)
    now = timezone.now()
    muted = Membership.objects.filter(conversation_id=message.conversation_id, is_muted=True).filter(
        Q(muted_until__isnull=True) | Q(muted_until__gt=now)).values('user_id')
    # من أُشير إليه بـ @ يصله الإشعار حتى لو كتم المجموعة
    subs = list(PushSubscription.objects.filter(user__memberships__conversation_id=message.conversation_id)
                .exclude(user=sender).filter(~Q(user_id__in=muted) | Q(user_id__in=list(mentioned)))
                .select_related('user__profile'))
    if not subs:
        return
    base = {'conversation': message.conversation_id, 'url': f'/chat?c={message.conversation_id}',
            'tag': f'conversation-{message.conversation_id}'}
    payloads = {}  # (اللغة، مخفي؟) ← نص الإشعار: نبنيه مرة واحدة لكل تركيبة

    def payload_for(user):
        key = (_language(user), _hides(user))
        if key not in payloads:
            with translation.override(key[0]):
                if key[1]:
                    # "إخفاء محتوى الإشعار": لا اسم المرسل ولا النص، حتى لو رأى أحد شاشة الهاتف المقفلة
                    data = {'title': _('وَصل'), 'body': _('رسالة جديدة')}
                else:
                    body = (preview(_) if preview else message.content)[:100]
                    if conv.kind == 'channel':  # القناة تتكلم باسمها لا باسم المشرف
                        data = {'title': conv.title or _('قناة'), 'body': body}
                    elif conv.kind == 'group':
                        data = {'title': conv.title or _('مجموعة'), 'body': f'{sender_name}: {body}'}
                    else:
                        data = {'title': sender_name, 'body': body}
            # العربية دون ترميز \uXXXX = إشعار أصغر
            payloads[key] = json.dumps({**base, **data, 'lang': key[0]}, ensure_ascii=False)
        return payloads[key]

    # بالخلفية حتى الرسالة ما تتأخر بانتظار خدمة الإشعارات
    _dispatch([(sub, payload_for(sub.user)) for sub in subs])


def _hides(user):
    profile = getattr(user, 'profile', None)
    return bool(profile and profile.hide_preview)


def _language(user):
    profile = getattr(user, 'profile', None)
    return profile.language if profile else 'ar'


def in_language(user, build):
    """ينفّذ build() بلغة المستخدم (مثلاً: نص إشعار المكالمة الواردة)."""
    with translation.override(_language(user)):
        return build()


def send_to_user(user, payload_dict):
    """إشعار لمستخدم معين (مثلاً: مكالمة واردة)."""
    subs = list(PushSubscription.objects.filter(user=user))
    if not subs:
        return
    payload = json.dumps(payload_dict, ensure_ascii=False)
    _dispatch([(sub, payload) for sub in subs])


def _deliver(sub, payload):
    """
    يرسل إشعاراً واحداً ويعيد النتيجة: {ok, host, status, reason}.
    Urgency: high = تسليم فوري (خدمة Apple تؤجل غير العاجل لتوفير البطارية).
    """
    host = urlparse(sub.endpoint).hostname or ''
    try:
        webpush(sub.as_subscription_info(), payload,
                vapid_private_key=get_signer(),
                vapid_claims={'sub': settings.VAPID_CONTACT},
                ttl=60 * 60 * 24, headers={'Urgency': 'high'},
                timeout=PUSH_TIMEOUT, requests_session=_session())
        return {'ok': True, 'host': host, 'status': 201, 'reason': ''}
    except WebPushException as exc:
        response = getattr(exc, 'response', None)
        status = getattr(response, 'status_code', None)
        text = getattr(response, 'text', None)
        reason = (text if isinstance(text, str) and text else str(exc))[:200]
        if status not in (404, 410):
            log.warning('push failed for %s (%s): %s', host, status, reason)
        return {'ok': False, 'host': host, 'status': status, 'reason': reason}
    except Exception as exc:  # noqa: BLE001
        # خطأ قبل الإرسال (توقيع VAPID، مفاتيح الاشتراك، الشبكة): كان يضيع بصمت داخل _pool فلا يصل أي إشعار
        # ولا يظهر أي سجل. نسجّله ونعيده لزر الإشعار التجريبي
        log.exception('push failed for %s before sending', host)
        return {'ok': False, 'host': host, 'status': None, 'reason': f'{type(exc).__name__}: {exc}'[:200]}


def _gone(result):
    """
    اشتراك لن يصل عليه أي إشعار بعد الآن، فنحذفه:
    404/410 = ألغاه المتصفح أو Apple، و VapidPkHashMismatch = أُنشئ بمفتاح خادم آخر (خادم جديد أو مفاتيح جديدة).
    """
    return result['status'] in (404, 410) or (result['status'] == 403 and 'VapidPkHashMismatch' in result['reason'])


def _dispatch(jobs):
    """
    jobs = [(اشتراك, نص الإشعار)]: كل جهاز في مهمة مستقلة على العمال معاً، لا بالتتابع
    (في مجموعة من 40 جهازاً كان الأخير ينتظر وصول الـ 39 قبله، ثوانيَ عدة).
    """
    if getattr(settings, 'PUSH_RUN_INLINE', False):
        for sub, payload in jobs:
            _send_one(sub, payload)
        return
    for sub, payload in jobs:
        _pool.submit(_send_one, sub, payload)


def _send_one(sub, payload):
    try:
        if _gone(_deliver(sub, payload)):
            PushSubscription.objects.filter(id=sub.id).delete()
    finally:
        if not getattr(settings, 'PUSH_RUN_INLINE', False):
            close_old_connections()


def send_test(user):
    """إشعار تجريبي لكل أجهزة المستخدم، الآن (دون طابور)، ويعيد نتيجة كل جهاز لعرضها في الإعدادات."""
    subs = list(PushSubscription.objects.filter(user=user).select_related('user__profile'))
    with translation.override(_language(user)):
        payload = json.dumps({'title': _('وَصل'), 'body': _('هذا إشعار تجريبي. الإشعارات تعمل ✅'),
                              'url': '/chat', 'tag': 'test', 'lang': _language(user)}, ensure_ascii=False)
    results = [_deliver(sub, payload) for sub in subs]
    dead = [sub.id for sub, r in zip(subs, results) if _gone(r)]
    PushSubscription.objects.filter(id__in=dead).delete()
    return results
