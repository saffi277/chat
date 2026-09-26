"""
Consumer = مثل الـ View بس للـ WebSocket.
الـ View: Request واحد → Response واحد وينسد الاتصال.
الـ Consumer: اتصال يبقى مفتوح، والطرفين يدزون رسائل بأي وقت.
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.utils import timezone

from accounts.models import Profile

from .models import Conversation
from .services import create_message, group_name

PRESENCE_GROUP = 'presence'


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope['user']
        self.conv_id = int(self.scope['url_route']['kwargs']['conversation_id'])
        if not self.user.is_authenticated or not await self.is_participant():
            await self.close(code=4403)
            return
        self.group = group_name(self.conv_id)
        # ننضم لـ "غرفة" المحادثة حتى نستلم أي رسالة تنبث بيها
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content):
        # الواجهة تدز: {"type": "message", "content": "هلو"}
        if content.get('type') == 'message':
            text = (content.get('content') or '').strip()
            if not text:
                return
            data = await database_sync_to_async(create_message)(await self.get_conversation(), self.user, text)
            await self.channel_layer.group_send(
                self.group, {'type': 'chat.event', 'payload': {'type': 'message', 'message': data}})
        elif content.get('type') == 'typing':
            await self.channel_layer.group_send(
                self.group, {'type': 'chat.event', 'payload': {'type': 'typing', 'user_id': self.user.id}})

    async def chat_event(self, event):
        # تنادى لما يوصل group_send بنوع chat.event → ندزه للمتصفح JSON
        await self.send_json(event['payload'])

    @database_sync_to_async
    def is_participant(self):
        return Conversation.objects.filter(pk=self.conv_id, participants=self.user).exists()

    @database_sync_to_async
    def get_conversation(self):
        return Conversation.objects.get(pk=self.conv_id)


class PresenceConsumer(AsyncJsonWebsocketConsumer):
    """اتصال عام يبقى مفتوح طول ما التطبيق مفتوح → نعرف منه Online/Offline."""

    async def connect(self):
        self.user = self.scope['user']
        if not self.user.is_authenticated:
            await self.close(code=4401)
            return
        await self.channel_layer.group_add(PRESENCE_GROUP, self.channel_name)
        await self.accept()
        await self.set_online(True)

    async def disconnect(self, code):
        if getattr(self.user, 'is_authenticated', False):
            await self.set_online(False)
            await self.channel_layer.group_discard(PRESENCE_GROUP, self.channel_name)

    async def set_online(self, online):
        await self.save_status(online)
        await self.channel_layer.group_send(PRESENCE_GROUP, {
            'type': 'chat.event',
            'payload': {'type': 'presence', 'user_id': self.user.id, 'is_online': online}})

    async def chat_event(self, event):
        await self.send_json(event['payload'])

    @database_sync_to_async
    def save_status(self, online):
        Profile.objects.update_or_create(
            user=self.user, defaults={'is_online': online, 'last_seen': timezone.now()})
