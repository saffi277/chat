# منطق مشترك بين الـ HTTP API والـ WebSocket حتى ما نكرر الكود
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from notifications.push import notify_new_message

from .models import Message
from .serializers import MessageSerializer


def group_name(conversation_id):
    return f'chat_{conversation_id}'


def user_group(user_id):
    return f'user_{user_id}'


def create_message(conversation, sender, content):
    """1) نخزن الرسالة بالـ Database  2) ننبّه المشاركين  3) نرجعها JSON."""
    msg = Message.objects.create(conversation=conversation, sender=sender, content=content)
    data = MessageSerializer(msg).data
    # تنبيه شخصي لكل مشارك (حتى لو المحادثة مو مفتوحة عنده) حتى تتحدث قائمته
    layer = get_channel_layer()
    for user_id in conversation.participants.values_list('id', flat=True):
        async_to_sync(layer.group_send)(
            user_group(user_id), {'type': 'chat.event', 'payload': {'type': 'inbox', 'message': data}})
    # إشعار Push للي التطبيق مسدود عندهم
    notify_new_message(msg)
    return data


def broadcast(conversation_id, payload):
    """نبث حدث لكل المتصلين بهاي المحادثة عبر الـ channel layer."""
    async_to_sync(get_channel_layer().group_send)(
        group_name(conversation_id), {'type': 'chat.event', 'payload': payload}
    )
