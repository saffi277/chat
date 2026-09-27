"""
Consumer = مثل الـ View بس للـ WebSocket.
الـ View: Request واحد → Response واحد وينسد الاتصال.
الـ Consumer: اتصال يبقى مفتوح، والطرفين يدزون رسائل بأي وقت.
"""
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import F
from django.utils import timezone

from accounts.models import Profile

from .models import Conversation, Membership, Message
from .services import create_message, group_name, mark_delivered, user_group

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
        # الواجهة تدز: {"type": "message", "content": "هلو", "reply_to": 12 (اختياري)}
        # (الصور والملفات والموقع تنرسل بـ HTTP لأن الـ WebSocket مو مناسب للملفات)
        if content.get('type') == 'message':
            text = (content.get('content') or '').strip()
            if text:
                # create_message نفسها تبث الرسالة للكل
                await self.send_text_message(text, content.get('reply_to'))
        elif content.get('type') == 'typing':
            await self.channel_layer.group_send(
                self.group, {'type': 'chat.event', 'payload': {'type': 'typing', 'user_id': self.user.id}})

    async def chat_event(self, event):
        # تنادى لما يوصل group_send بنوع chat.event → ندزه للمتصفح JSON
        await self.send_json(event['payload'])

    @database_sync_to_async
    def is_participant(self):
        return Membership.objects.filter(conversation_id=self.conv_id, user=self.user).exists()

    @database_sync_to_async
    def send_text_message(self, text, reply_to):
        conv = Conversation.objects.get(pk=self.conv_id)
        reply = Message.objects.filter(pk=reply_to, conversation=conv).first() if reply_to else None
        create_message(conv, self.user, text, reply_to=reply)


class PresenceConsumer(AsyncJsonWebsocketConsumer):
    """اتصال عام يبقى مفتوح طول ما التطبيق مفتوح → Online/Offline + تنبيهات الرسائل الجديدة."""

    async def connect(self):
        self.user = self.scope['user']
        if not self.user.is_authenticated:
            await self.close(code=4401)
            return
        await self.channel_layer.group_add(PRESENCE_GROUP, self.channel_name)
        await self.channel_layer.group_add(user_group(self.user.id), self.channel_name)
        await self.accept()
        await self.connections(+1)
        await self.set_online(True)
        # الجهاز صار متصل: كل الرسائل اللي جاته وهو مطفي صارت "وصلت" ✓✓
        await database_sync_to_async(mark_delivered)(self.user)

    async def disconnect(self, code):
        if getattr(self.user, 'is_authenticated', False):
            # إذا فاتح التطبيق بأكثر من تبويب/جهاز، يبقى "متصل" لحد ما يسد آخر واحد
            if await self.connections(-1) <= 0:
                await self.set_online(False)
            await self.channel_layer.group_discard(PRESENCE_GROUP, self.channel_name)
            await self.channel_layer.group_discard(user_group(self.user.id), self.channel_name)

    async def set_online(self, online):
        await self.save_status(online)
        await self.channel_layer.group_send(PRESENCE_GROUP, {
            'type': 'chat.event',
            'payload': {'type': 'presence', 'user_id': self.user.id, 'is_online': online}})

    async def receive_json(self, content):
        """
        رسائل تعارف المكالمة (WebRTC signaling): offer / answer / ice candidate.
        الواجهة تدز: {"type": "call.signal", "call_id": 3, "to": <user_id>, "data": {...}}
        وإحنا نوصلها للطرف الثاني كما هي. السيرفر ما يفهمها ولا يحتاج يفهمها.
        """
        if content.get('type') == 'call.signal':
            to = await self.signal_target(content.get('call_id'), content.get('to'))
            if to:
                await self.channel_layer.group_send(user_group(to), {'type': 'chat.event', 'payload': {
                    'type': 'call.signal', 'call_id': content['call_id'], 'from': self.user.id,
                    'data': content.get('data')}})

    @database_sync_to_async
    def signal_target(self, call_id, to):
        """نتأكد إن الاثنين بنفس المكالمة، وإنها بعدها شغالة."""
        from calls.models import Call
        try:
            call = Call.objects.get(pk=int(call_id), status__in=[Call.RINGING, Call.ONGOING])
            to = int(to)
        except (Call.DoesNotExist, TypeError, ValueError):
            return None
        members = Membership.objects.filter(conversation_id=call.conversation_id, user_id__in=[self.user.id, to])
        return to if to != self.user.id and members.count() == 2 else None

    async def chat_event(self, event):
        payload = event['payload']
        await self.send_json(payload)
        # رسالة جديدة وصلت لهذا الجهاز → نعلمها "وصلت"
        if payload.get('type') == 'inbox' and payload['message']['sender']['id'] != self.user.id:
            await database_sync_to_async(mark_delivered)(self.user, [payload['message']['conversation']])

    @database_sync_to_async
    def connections(self, delta):
        profile, _ = Profile.objects.get_or_create(user=self.user)
        Profile.objects.filter(pk=profile.pk).update(connections=F('connections') + delta)
        profile.refresh_from_db(fields=['connections'])
        if profile.connections < 0:
            Profile.objects.filter(pk=profile.pk).update(connections=0)
        return profile.connections

    @database_sync_to_async
    def save_status(self, online):
        Profile.objects.update_or_create(
            user=self.user, defaults={'is_online': online, 'last_seen': timezone.now()})
