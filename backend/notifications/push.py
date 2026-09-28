import json
import logging
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.db import close_old_connections
from pywebpush import WebPushException, webpush

from .models import PushSubscription
from .vapid import get_signer

log = logging.getLogger(__name__)
# عدد ثابت من العمال للإشعارات: لو انرسلت 2000 رسالة سوه ما نفتح 2000 thread،
# تنتظر بالطابور وتنرسل بالتسلسل بدون ما تبطئ الرسائل نفسها
_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix='push')


def notify_new_message(message, preview=None):
    """ندز إشعار لكل عضو بالمحادثة غير المرسل (وغير اللي كاتمها)، على كل أجهزته."""
    sender = message.sender
    profile = getattr(sender, 'profile', None)
    sender_name = (profile.display_name if profile and profile.display_name else sender.username)
    conv = message.conversation
    body = (preview or message.content)[:100]
    if conv.kind == 'saved':
        return
    if conv.kind == 'group':
        title, body = conv.title or 'مجموعة', f'{sender_name}: {body}'
    else:
        title = sender_name
    payload = json.dumps({
        'title': title,
        'body': body,
        'conversation': message.conversation_id,
        'url': f'/chat?c={message.conversation_id}',
        'tag': f'conversation-{message.conversation_id}',
    }, ensure_ascii=False)  # العربي بدون ترميز \uXXXX = إشعار أصغر
    subs = list(PushSubscription.objects.filter(
        user__memberships__conversation_id=message.conversation_id,
        user__memberships__is_muted=False).exclude(user=sender))
    if not subs:
        return
    if getattr(settings, 'PUSH_RUN_INLINE', False):
        _send_all(subs, payload)
    else:
        # بالخلفية حتى الرسالة ما تتأخر بانتظار خدمة الإشعارات
        _pool.submit(_send_all, subs, payload)


def send_to_user(user, payload_dict):
    """إشعار لمستخدم معين (مثلاً: مكالمة واردة)."""
    subs = list(PushSubscription.objects.filter(user=user))
    if not subs:
        return
    payload = json.dumps(payload_dict, ensure_ascii=False)
    if getattr(settings, 'PUSH_RUN_INLINE', False):
        _send_all(subs, payload)
    else:
        _pool.submit(_send_all, subs, payload)


def _send_all(subs, payload):
    dead = []
    for sub in subs:
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
