# منطق مشترك بين الـ HTTP API والـ WebSocket حتى ما نكرر الكود
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db.models import Max
from django.utils import timezone

from notifications.push import notify_new_message

from .models import Membership, Message

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


def _send(group, payload):
    async_to_sync(get_channel_layer().group_send)(group, {'type': 'chat.event', 'payload': payload})


def broadcast(conversation_id, payload):
    """نبث حدث لكل المتصلين بهاي المحادثة (الفاتحينها هسه)."""
    _send(group_name(conversation_id), payload)


def send_to_users(user_ids, payload):
    """نبث حدث لكل مستخدم على اتصاله العام (حتى لو المحادثة مو مفتوحة عنده)."""
    for user_id in user_ids:
        _send(user_group(user_id), payload)


def send_to_everyone(payload):
    """لكل المتصلين (مجموعة presence العامة)."""
    _send('presence', payload)


def member_ids(conversation):
    return list(conversation.memberships.values_list('user_id', flat=True))


def preview_text(message):
    """النص المختصر اللي يطلع بالقائمة وبالإشعار."""
    if message.deleted_at:
        return '🚫 تم حذف هذه الرسالة'
    if message.kind == Message.LOCATION and message.is_live:
        return '📍 موقع مباشر'
    if message.kind == Message.CALL:
        return f'📞 {message.content}'
    base = PREVIEWS.get(message.kind)
    if base and message.content:
        return f'{base}: {message.content}'
    return base or message.content


def serialize_message(message):
    from .serializers import MessageSerializer
    return MessageSerializer(message, context={'receipts': receipts_for(message.conversation)}).data


def receipts_for(conversation):
    return list(conversation.memberships.values('user_id', 'last_delivered_id', 'last_read_id'))


def create_message(conversation, sender, content='', **fields):
    """1) نخزن الرسالة بالـ Database  2) نبثها للكل  3) إشعار Push  4) نرجعها JSON."""
    msg = Message.objects.create(conversation=conversation, sender=sender, content=content, **fields)
    # المرسل طبعاً "قرا" رسالته
    Membership.objects.filter(conversation=conversation, user=sender).update(
        last_read_id=msg.id, last_delivered_id=msg.id)
    data = serialize_message(msg)
    # للي فاتحين المحادثة: الرسالة نفسها
    broadcast(conversation.id, {'type': 'message', 'message': data})
    # لكل عضو على اتصاله العام: حتى تتحدث قائمته (وهذا يعلّم الرسالة "وصلت" لجهازه)
    send_to_users(member_ids(conversation), {'type': 'inbox', 'message': data})
    if msg.kind not in QUIET:
        notify_new_message(msg, preview_text(msg))
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
    if conversation.kind != conversation.GROUP:
        conversation.messages.filter(is_read=False).exclude(sender=user).update(is_read=True)
    broadcast(conversation.id, {'type': 'read', 'reader_id': user.id, 'message_id': last})
    return updated


def mark_delivered(user, conversation_ids=None):
    """الرسائل وصلت لجهاز المستخدم (عنده اتصال مفتوح): نحدّث ✓ إلى ✓✓."""
    memberships = Membership.objects.filter(user=user).select_related('conversation')
    if conversation_ids is not None:
        memberships = memberships.filter(conversation_id__in=conversation_ids)
    for m in memberships:
        last = m.conversation.messages.aggregate(x=Max('id'))['x'] or 0
        if last > m.last_delivered_id:
            Membership.objects.filter(pk=m.pk).update(last_delivered_id=last)
            broadcast(m.conversation_id, {'type': 'delivered', 'user_id': user.id, 'message_id': last})


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
