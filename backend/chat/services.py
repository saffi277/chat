# منطق مشترك بين الـ HTTP API والـ WebSocket حتى ما نكرر الكود
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .models import Message
from .serializers import MessageSerializer


def group_name(conversation_id):
    return f'chat_{conversation_id}'


def create_message(conversation, sender, content):
    """1) نخزن الرسالة بالـ Database  2) نرجعها JSON."""
    msg = Message.objects.create(conversation=conversation, sender=sender, content=content)
    return MessageSerializer(msg).data


def broadcast(conversation_id, payload):
    """نبث حدث لكل المتصلين بهاي المحادثة عبر الـ channel layer."""
    async_to_sync(get_channel_layer().group_send)(
        group_name(conversation_id), {'type': 'chat.event', 'payload': payload}
    )
