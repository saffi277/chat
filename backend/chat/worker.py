"""
العامل الخلفي: كل 15 ثانية
  1) يرسل الرسائل المجدولة التي حان وقتها.
  2) يحذف الرسائل المختفية التي انتهت مدتها.

يعمل داخل عملية الخادم نفسها (config/asgi.py يشغّله في thread)، أو وحده: python manage.py run_worker
إن عمل أكثر من عامل معاً فلا تُرسل رسالة مرتين: كل عامل «يحجز» الرسالة بتغيير حالتها من pending إلى sending
بأمر UPDATE واحد، ومن ينجح في ذلك (عدد الصفوف = 1) هو وحده من يرسلها. هذا يعمل في SQLite وPostgreSQL معاً.
"""
import logging
import threading
import time

from django.db import close_old_connections
from django.utils import timezone, translation

from . import services
from .models import Membership, Message, ScheduledMessage

log = logging.getLogger(__name__)
EVERY = 15  # ثانية
BATCH = 200

_started = False
_lock = threading.Lock()


def send_due_scheduled(now=None):
    now = now or timezone.now()
    sent = 0
    due = list(ScheduledMessage.objects.filter(status=ScheduledMessage.PENDING, send_at__lte=now)
               .order_by('send_at').values_list('id', flat=True)[:BATCH])
    for sid in due:
        # الحجز: عامل واحد فقط ينجح في تغيير الحالة
        if not ScheduledMessage.objects.filter(pk=sid, status=ScheduledMessage.PENDING).update(
                status=ScheduledMessage.SENDING):
            continue
        s = ScheduledMessage.objects.select_related('sender__profile', 'conversation').get(pk=sid)
        m = Membership.objects.filter(conversation=s.conversation, user=s.sender).select_related('conversation').first()
        # قد يكون غادر المجموعة، أو صار الإرسال للمشرفين فقط بعد الجدولة
        lang = getattr(getattr(s.sender, 'profile', None), 'language', 'ar')
        with translation.override(lang):
            err = ('not_member', translation.gettext('لم تعد عضواً في هذه المحادثة')) if not m else services.post_error(m, check_slow=False)
        if err:
            ScheduledMessage.objects.filter(pk=sid).update(status=ScheduledMessage.FAILED, error=err[1][:200])
        else:
            try:
                reply = s.reply_to if s.reply_to_id and s.reply_to and s.reply_to.conversation_id == s.conversation_id else None
                services.create_message(s.conversation, s.sender, s.content, silent=s.silent, reply_to=reply)
                s.delete()
                sent += 1
            except Exception:  # لا نوقف العامل بسبب رسالة واحدة
                log.exception('scheduled message %s failed', sid)
                ScheduledMessage.objects.filter(pk=sid).update(status=ScheduledMessage.FAILED, error='error')
        services.send_to_users([s.sender_id], {'type': 'scheduled_changed', 'conversation_id': s.conversation_id})
    return sent


def delete_expired(now=None):
    now = now or timezone.now()
    removed = 0
    for msg in Message.objects.filter(expires_at__lte=now).select_related('conversation')[:BATCH]:
        services.remove_message(msg)
        removed += 1
    return removed


def tick():
    close_old_connections()
    try:
        return send_due_scheduled(), delete_expired()
    finally:
        close_old_connections()


def _loop():
    while True:
        try:
            tick()
        except Exception:
            log.exception('worker tick failed')
        time.sleep(EVERY)


def start():
    """يشغّل العامل مرة واحدة في هذه العملية (thread في الخلفية)."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_loop, name='wasl-worker', daemon=True).start()
