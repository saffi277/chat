# منطق مشترك بين الـ HTTP API والـ WebSocket حتى ما نكرر الكود
import asyncio
import threading

from asgiref.sync import SyncToAsync, async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from django.db.models import Max, OuterRef, Subquery
from django.utils import timezone

from accounts.models import Contact, Profile
from notifications.push import notify_new_message

from .models import Conversation, Membership, Message

PREVIEWS = {
    Message.IMAGE: '📷 صورة',
    Message.VIDEO: '🎬 فيديو',
    Message.VOICE: '🎤 رسالة صوتية',
    Message.FILE: '📎 ملف',
    Message.LOCATION: '📍 موقع',
}
QUIET = (Message.SYSTEM, Message.CALL)  # ما إلها إشعار Push


def group_name(conversation_id):
    return f'chat_{conversation_id}'


def user_group(user_id):
    return f'user_{user_id}'


_loop = None
_loop_lock = threading.Lock()


def _background_loop():
    """حلقة async وحدة دائمة لكل عملية (بسيرفر الـ HTTP)، حتى البث يعيد استخدام نفس اتصال Redis
    بدل ما يفتح اتصال جديد لكل رسالة (async_to_sync بدون حلقة يسوي حلقة جديدة كل مرة)."""
    global _loop
    with _loop_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            threading.Thread(target=_loop.run_forever, name='channels-send', daemon=True).start()
    return _loop


def _send(group, payload):
    message = {'type': 'chat.event', 'payload': payload}
    layer = get_channel_layer()
    if getattr(SyncToAsync.threadlocal, 'main_event_loop', None) is not None:
        # داخل سيرفر الـ WebSocket (ASGI): نرجع لنفس الحلقة الأساسية
        async_to_sync(layer.group_send)(group, message)
    else:
        # سيرفر الـ HTTP (Gunicorn threads): الحلقة الدائمة
        asyncio.run_coroutine_threadsafe(layer.group_send(group, message), _background_loop()).result(timeout=10)


def broadcast(conversation_id, payload):
    """نبث حدث لكل المتصلين بهاي المحادثة (الفاتحينها هسه)."""
    _send(group_name(conversation_id), payload)


def send_to_users(user_ids, payload):
    """نبث حدث لكل مستخدم على اتصاله العام (حتى لو المحادثة مو مفتوحة عنده)."""
    for user_id in user_ids:
        _send(user_group(user_id), payload)


def _shared_ids(user_id):
    """من يشاركني محادثة ثنائية أو مجموعة. (القنوات لا تُعرّف المشتركين ببعضهم: قد يكونون آلافاً لا يعرف أحدهم الآخر)"""
    mine = (Membership.objects.filter(user_id=user_id).exclude(conversation__kind=Conversation.CHANNEL)
            .values('conversation_id'))
    return set(Membership.objects.filter(conversation_id__in=mine).exclude(user_id=user_id)
               .values_list('user_id', flat=True).distinct())


def contact_ids(user_id):
    """
    من يهمه أن يعرف حالتي (متصل الآن، أو نشرتُ حالة): من يشاركني محادثة، ومن أضافني أو أضفته جهة اتصال.
    قبل كنا نبث لكل الجامعة: 2000 متصل × 2000 = 4 مليون رسالة لما الكل يدخل سوه.
    نحفظها بالكاش دقيقة حتى ما نسأل قاعدة البيانات كل مرة.
    """
    key = f'contacts:{user_id}'
    ids = cache.get(key)
    if ids is None:
        ids = _shared_ids(user_id)
        ids |= set(Contact.objects.filter(owner_id=user_id).values_list('contact_id', flat=True))
        ids |= set(Contact.objects.filter(contact_id=user_id).values_list('owner_id', flat=True))
        ids = sorted(ids)
        cache.set(key, ids, 60)
    return ids


def known_ids(user_id):
    """
    من أستطيع رؤيته والبحث عنه ومراسلته وإضافته إلى مجموعة: جهات اتصالي، ومن يشاركني محادثة،
    ومن أضافني جهةَ اتصال (حتى أستطيع الرد عليه). غيرهم لا يظهرون لي أبداً.
    """
    return set(contact_ids(user_id))


def my_contact_ids(user_id):
    """جهات الاتصال التي أضفتُها أنا فقط (ما يظهر في تبويب جهات الاتصال)."""
    return set(Contact.objects.filter(owner_id=user_id).values_list('contact_id', flat=True))


def forget_contacts(*user_ids):
    """المحادثات أو جهات الاتصال تغيرت (مجموعة جديدة، عضو انضاف، جهة اتصال جديدة): نمسح الكاش."""
    cache.delete_many([f'contacts:{u}' for u in user_ids])


def can_broadcast(user):
    """النشر في القنوات وإنشاؤها: للتدريسيين والإداريين فقط (ولمدير النظام)."""
    if user.is_staff or user.is_superuser:
        return True
    profile = getattr(user, 'profile', None)
    return bool(profile and profile.role in (Profile.FACULTY, Profile.STAFF))


def send_to_contacts(user_id, payload, include_self=True):
    send_to_users([*contact_ids(user_id), *([user_id] if include_self else [])], payload)


def member_ids(conversation):
    return list(conversation.memberships.values_list('user_id', flat=True))


def preview_text(message, tr=lambda text: text):
    """
    النص المختصر الذي يظهر في القائمة وفي الإشعار.
    يُحفظ ويُبث بالعربية دائماً (والواجهة تترجمه)، أما الإشعار فيُترجم لكل مستلم: tr=gettext مع لغته.
    """
    if message.deleted_at:
        return tr('🚫 تم حذف هذه الرسالة')
    if message.kind == Message.LOCATION and message.is_live:
        return tr('📍 موقع مباشر')
    if message.kind == Message.CALL:
        return f'📞 {tr(message.content)}'
    base = PREVIEWS.get(message.kind)
    if base and message.content:
        return f'{tr(base)}: {message.content}'
    return tr(base) if base else message.content


def serialize_message(message):
    from .serializers import MessageSerializer
    return MessageSerializer(message, context={'receipts': receipts_for(message.conversation)}).data


def receipts_for(conversation):
    # القناة: لا علامات قراءة (قد يكون المشتركون آلافاً، وقراءتهم ليست شأن الناشر)
    if conversation.kind == Conversation.CHANNEL:
        return None
    return list(conversation.memberships.values('user_id', 'last_delivered_id', 'last_read_id'))


def create_message(conversation, sender, content='', **fields):
    """1) نخزن الرسالة بالـ Database  2) نبثها للكل  3) إشعار Push  4) نرجعها JSON."""
    msg = Message.objects.create(conversation=conversation, sender=sender, content=content, **fields)
    # المرسل طبعاً "قرا" رسالته
    Membership.objects.filter(conversation=conversation, user=sender).update(
        last_read_id=msg.id, last_delivered_id=msg.id)
    # "وصلت ✓✓" لكل عضو جهازه متصل هسه (الرسالة راح توصله مباشرة): استعلام واحد لكل الأعضاء،
    # بدل ما كل جهاز يكتب بقاعدة البيانات لحاله (مجموعة 40 شخص كانت = 80 عملية لكل رسالة)
    online = list(Membership.objects.filter(conversation=conversation, user__profile__connections__gt=0)
                  .exclude(user=sender).values_list('user_id', flat=True))
    if online:
        Membership.objects.filter(conversation=conversation, user_id__in=online, last_delivered_id__lt=msg.id).update(
            last_delivered_id=msg.id)
    data = serialize_message(msg)
    # للي فاتحين المحادثة: الرسالة نفسها
    broadcast(conversation.id, {'type': 'message', 'message': data})
    if online:
        broadcast(conversation.id, {'type': 'delivered', 'user_id': online[0] if len(online) == 1 else 0,
                                    'message_id': msg.id})
    # لكل عضو على اتصاله العام: حتى تتحدث قائمته
    send_to_users(member_ids(conversation), {'type': 'inbox', 'message': data})
    if msg.kind not in QUIET:
        notify_new_message(msg, lambda tr: preview_text(msg, tr))
    return data


def system_message(conversation, actor, text):
    """رسالة رمادية بالنص مثل "مصطفى أضاف زينب"."""
    return create_message(conversation, actor, text, kind=Message.SYSTEM)


def message_changed(message):
    """بعد تعديل أو حذف أو تحديث موقع: نبلغ الكل بالنسخة الجديدة."""
    data = serialize_message(message)
    broadcast(message.conversation_id, {'type': 'message_updated', 'message': data})
    send_to_users(member_ids(message.conversation), {'type': 'inbox', 'message': data})
    return data


def mark_read(conversation, user):
    """المستخدم فتح المحادثة: كل اللي بيها صار مقروء."""
    last = conversation.messages.aggregate(m=Max('id'))['m'] or 0
    updated = Membership.objects.filter(conversation=conversation, user=user, last_read_id__lt=last).update(
        last_read_id=last)
    if not updated:
        return 0
    Membership.objects.filter(conversation=conversation, user=user, last_delivered_id__lt=last).update(
        last_delivered_id=last)
    # للمحادثات الثنائية نحدث is_read على الرسائل نفسها (الواجهة القديمة تعتمد عليه)
    if conversation.kind == Conversation.DIRECT:
        conversation.messages.filter(is_read=False).exclude(sender=user).update(is_read=True)
    broadcast(conversation.id, {'type': 'read', 'reader_id': user.id, 'message_id': last})
    return updated


def mark_delivered(user, conversation_ids=None):
    """الرسائل وصلت لجهاز المستخدم (عنده اتصال مفتوح): نحدّث ✓ إلى ✓✓.
    استعلام واحد يجيب آخر رسالة لكل محادثة (بدل استعلام لكل محادثة)."""
    last_id = Message.objects.filter(conversation_id=OuterRef('conversation_id')).order_by('-id').values('id')[:1]
    memberships = Membership.objects.filter(user=user).annotate(last=Subquery(last_id))
    if conversation_ids is not None:
        memberships = memberships.filter(conversation_id__in=conversation_ids)
    for m in memberships:
        if m.last and m.last > m.last_delivered_id:
            Membership.objects.filter(pk=m.pk, last_delivered_id__lt=m.last).update(last_delivered_id=m.last)
            broadcast(m.conversation_id, {'type': 'delivered', 'user_id': user.id, 'message_id': m.last})


def soft_delete(message):
    """نمسح المحتوى والملف، ونخلي أثر "تم حذف هذه الرسالة"."""
    if message.file:
        message.file.delete(save=False)
    message.content = ''
    message.file = None
    message.file_name = ''
    message.latitude = message.longitude = None
    message.live_until = None
    message.deleted_at = timezone.now()
    message.save()
    return message_changed(message)
