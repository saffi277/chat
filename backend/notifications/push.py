import json
import logging
import threading

from django.conf import settings
from django.db import close_old_connections
from pywebpush import WebPushException, webpush

from .models import PushSubscription
from .vapid import get_signer

log = logging.getLogger(__name__)


def notify_new_message(message):
    """ندز إشعار لكل مشارك بالمحادثة غير المرسل، على كل أجهزته."""
    sender = message.sender
    profile = getattr(sender, 'profile', None)
    title = (profile.display_name if profile and profile.display_name else sender.username)
    payload = json.dumps({
        'title': title,
        'body': message.content[:100],
        'conversation': message.conversation_id,
        'url': f'/chat?c={message.conversation_id}',
        'tag': f'conversation-{message.conversation_id}',
    }, ensure_ascii=False)  # العربي بدون ترميز \uXXXX = إشعار أصغر
    subs = list(PushSubscription.objects.filter(
        user__conversations=message.conversation_id).exclude(user=sender))
    if not subs:
        return
    if getattr(settings, 'PUSH_RUN_INLINE', False):
        _send_all(subs, payload)
    else:
        # بـ thread منفصل حتى الرسالة ما تتأخر بانتظار خدمة الإشعارات
        threading.Thread(target=_send_all, args=(subs, payload), daemon=True).start()


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
