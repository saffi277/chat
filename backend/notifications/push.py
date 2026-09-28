import json
import logging
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import close_old_connections
from django.utils import translation
from django.utils.translation import gettext as _
from pywebpush import WebPushException, webpush

from .models import PushSubscription
from .vapid import get_signer

log = logging.getLogger(__name__)
# عدد ثابت من العمال للإشعارات: لو انرسلت 2000 رسالة سوه ما نفتح 2000 thread،
# تنتظر بالطابور وتنرسل بالتسلسل بدون ما تبطئ الرسائل نفسها
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix='push')


def notify_new_message(message, preview=None):
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
    subs = list(PushSubscription.objects.filter(
        user__memberships__conversation_id=message.conversation_id,
        user__memberships__is_muted=False).exclude(user=sender).select_related('user__profile'))
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
                    if conv.kind == 'group':
                        data = {'title': conv.title or _('مجموعة'), 'body': f'{sender_name}: {body}'}
                    else:
                        data = {'title': sender_name, 'body': body}
            # العربية دون ترميز \uXXXX = إشعار أصغر
            payloads[key] = json.dumps({**base, **data}, ensure_ascii=False)
        return payloads[key]

    jobs = [(sub, payload_for(sub.user)) for sub in subs]
    if getattr(settings, 'PUSH_RUN_INLINE', False):
        _send_all(jobs)
    else:
        # بالخلفية حتى الرسالة ما تتأخر بانتظار خدمة الإشعارات
        _pool.submit(_send_all, jobs)


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
    jobs = [(sub, payload) for sub in subs]
    if getattr(settings, 'PUSH_RUN_INLINE', False):
        _send_all(jobs)
    else:
        _pool.submit(_send_all, jobs)


def _send_all(jobs):
    """jobs = [(اشتراك, نص الإشعار)]: كل مستخدم يوصله الإشعار حسب إعداده."""
    dead = []
    for sub, payload in jobs:
        try:
            webpush(sub.as_subscription_info(), payload,
                    vapid_private_key=get_signer(),
                    vapid_claims={'sub': settings.VAPID_CONTACT}, ttl=60 * 60 * 24)
        except WebPushException as exc:
            status = getattr(exc.response, 'status_code', None)
            if status in (404, 410):  # المتصفح لغى الاشتراك
                dead.append(sub.id)
            else:
                log.warning('push failed for %s: %s', sub.endpoint[:60], exc)
    if dead:
        PushSubscription.objects.filter(id__in=dead).delete()
    if not getattr(settings, 'PUSH_RUN_INLINE', False):
        close_old_connections()
