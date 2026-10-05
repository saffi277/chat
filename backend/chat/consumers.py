"""
Consumer = مثل الـ View بس للـ WebSocket.
الـ View: Request واحد → Response واحد وينسد الاتصال.
الـ Consumer: اتصال يبقى مفتوح، والطرفين يدزون رسائل بأي وقت.
"""
import time
from collections import deque

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db.models import F
from django.db.models.functions import Greatest
from django.utils import timezone, translation

from accounts.models import Profile

from .models import Membership, Message
from .services import (clean_client_id, group_name, mark_delivered, post_error, presence_audience, send_once,
                       serialize_message, user_group)

# حدّ الإرسال عبر WebSocket لكل اتصال (مثل SendThrottle في HTTP): 20 رسالة كل 10 ثوانٍ،
# و«يكتب الآن» مرة في الثانية على الأكثر. ما زاد يُهمل، فلا يستطيع أحد إغراق المحادثة أو الخادم.
BURST, WINDOW = 20, 10.0
TYPING_EVERY = 1.0


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.user = self.scope['user']
        self.conv_id = int(self.scope['url_route']['kwargs']['conversation_id'])
        if not self.user.is_authenticated or not await self.is_participant():
            await self.close(code=4403)
            return
        self.group = group_name(self.conv_id)
        # الاسم يروح ويا "يكتب الآن" (حتى الواجهة ما تحتاج قائمة أعضاء المجموعة كاملة)
        self.display_name = await database_sync_to_async(
            lambda: getattr(getattr(self.user, 'profile', None), 'display_name', '') or self.user.username)()
        self.sent = deque()     # أوقات آخر الرسائل (لحدّ الإرسال)
        self.last_typing = 0.0
        # ننضم لـ "غرفة" المحادثة حتى نستلم أي رسالة تنبث بيها
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, 'group'):
            await self.channel_layer.group_discard(self.group, self.channel_name)

    async def receive_json(self, content):
        # الواجهة تدز: {"type": "message", "content": "هلو", "reply_to": 12 (اختياري)}
        # (الصور والملفات والموقع تنرسل بـ HTTP لأن الـ WebSocket مو مناسب للملفات)
        if content.get('type') == 'ping':
            # نبض الواجهة: إن لم يصلها الرد خلال ثوانٍ تعرف أن الاتصال مات (الهاتف في الخلفية، تبدّلت الشبكة) فتعيده فوراً
            await self.send_json({'type': 'pong'})
        elif content.get('type') == 'message':
            text = (content.get('content') or '').strip()
            # client_id: تظهر الرسالة عند المرسل فوراً «قيد الإرسال»، ونعيده معها ليطابقها (أو مع الخطأ ليعلّمها «لم تُرسل»)
            client_id = clean_client_id(content.get('client_id'))
            if text:
                if not self.allow_message():
                    await self.send_json({'type': 'error', 'detail': 'rate_limited', 'client_id': client_id})
                    return
                # create_message نفسها تبث الرسالة للكل. وإن مُنع (مجموعة للمشرفين، أو الوضع البطيء) نخبره بالسبب
                err, again = await self.send_text_message(text, content.get('reply_to'), content.get('silent') is True, client_id)
                if err:
                    await self.send_json({'type': 'error', 'detail': err[0], 'message': err[1], 'client_id': client_id})
                elif again:  # وصلت من قبل ولم يصله ردها: نعيدها له وحده
                    await self.send_json({'type': 'message', 'message': again})
        elif content.get('type') == 'typing' and self.can_post and self.allow_typing():
            await self.channel_layer.group_send(
                self.group, {'type': 'chat.event', 'payload': {'type': 'typing', 'user_id': self.user.id,
                                                              'name': self.display_name}})

    def allow_message(self):
        now = time.monotonic()
        while self.sent and now - self.sent[0] > WINDOW:
            self.sent.popleft()
        if len(self.sent) >= BURST:
            return False
        self.sent.append(now)
        return True

    def allow_typing(self):
        now = time.monotonic()
        if now - self.last_typing < TYPING_EVERY:
            return False
        self.last_typing = now
        return True

    async def chat_event(self, event):
        # تنادى لما يوصل group_send بنوع chat.event → ندزه للمتصفح JSON
        await self.send_json(event['payload'])

    @database_sync_to_async
    def is_participant(self):
        m = Membership.objects.filter(conversation_id=self.conv_id, user=self.user).select_related('conversation').first()
        # القناة (ومجموعة «الإرسال للمشرفين»): غير المشرف يستقبل فقط، ولا يظهر عنه «يكتب الآن»
        self.can_post = bool(m) and post_error(m, check_slow=False) is None
        return m is not None

    @database_sync_to_async
    def send_text_message(self, text, reply_to, silent=False, client_id=''):
        """يعيد (الخطأ أو None، والرسالة إن كانت قد وصلت من قبل)."""
        # أُرسلت من قبل (أعاد الجهاز إرسالها بعد انقطاع): لا تُنشأ مرتين ولا تخضع للوضع البطيء من جديد
        if client_id:
            existing = Message.objects.filter(sender=self.user, client_id=client_id, conversation_id=self.conv_id).first()
            if existing:
                return None, serialize_message(existing)
        # نتحقق من جديد في كل رسالة: ربما أُلغي إشرافه أو غيّر المشرف الإعدادات والاتصال مفتوح
        m = Membership.objects.filter(conversation_id=self.conv_id, user=self.user).select_related('conversation').first()
        if not m:
            return ('not_allowed', ''), None
        # نص الخطأ بلغة المستخدم (لا طلب HTTP هنا يحدد اللغة)
        with translation.override(getattr(getattr(self.user, 'profile', None), 'language', 'ar')):
            err = post_error(m)
        if err:
            return err, None
        conv = m.conversation
        reply = Message.objects.filter(pk=reply_to, conversation=conv).first() if reply_to else None
        data, created = send_once(conv, self.user, text, client_id, silent=silent, reply_to=reply)
        return None, (None if created else data)


class PresenceConsumer(AsyncJsonWebsocketConsumer):
    """اتصال عام يبقى مفتوح طول ما التطبيق مفتوح → Online/Offline + تنبيهات الرسائل الجديدة."""

    async def connect(self):
        self.user = self.scope['user']
        if not self.user.is_authenticated:
            await self.close(code=4401)
            return
        await self.channel_layer.group_add(user_group(self.user.id), self.channel_name)
        await self.accept()
        # كل شغل قاعدة البيانات بخطوة وحدة (بدل 6 استعلامات متفرقة) حتى الاتصال يكون سريع حتى لو الكل دخل سوه
        first, contacts = await self.came_online()
        if first:  # أول جهاز/تبويب: نبلغ معارفه إنه صار متصل
            await self.tell_contacts(contacts, True)

    async def disconnect(self, code):
        if getattr(self.user, 'is_authenticated', False):
            # إذا فاتح التطبيق بأكثر من تبويب/جهاز، يبقى "متصل" لحد ما يسد آخر واحد
            contacts = await self.went_offline()
            if contacts is not None:
                await self.tell_contacts(contacts, False)
            await self.channel_layer.group_discard(user_group(self.user.id), self.channel_name)

    async def tell_contacts(self, contacts, online):
        # بس للناس اللي يشاركوه محادثة (مو لكل الجامعة)
        event = {'type': 'chat.event', 'payload': {'type': 'presence', 'user_id': self.user.id, 'is_online': online}}
        for uid in contacts:
            await self.channel_layer.group_send(user_group(uid), event)

    async def receive_json(self, content):
        """
        رسائل تعارف المكالمة (WebRTC signaling): offer / answer / ice candidate.
        الواجهة تدز: {"type": "call.signal", "call_id": 3, "to": <user_id>, "data": {...}}
        وإحنا نوصلها للطرف الثاني كما هي. السيرفر ما يفهمها ولا يحتاج يفهمها.
        و{"type": "ping"}: نبض الواجهة، نرد عليه فوراً (انظر ChatConsumer).
        """
        if content.get('type') == 'ping':
            await self.send_json({'type': 'pong'})
        elif content.get('type') == 'call.signal':
            to = await self.signal_target(content.get('call_id'), content.get('to'))
            if to:
                await self.channel_layer.group_send(user_group(to), {'type': 'chat.event', 'payload': {
                    'type': 'call.signal', 'call_id': content['call_id'], 'from': self.user.id,
                    'data': content.get('data')}})

    @database_sync_to_async
    def signal_target(self, call_id, to):
        """نتأكد إن الاثنين بنفس المكالمة (أعضاء محادثتها أو مدعوّان إليها)، وإنها بعدها شغالة."""
        from calls.models import Call, CallInvite
        try:
            call = Call.objects.get(pk=int(call_id), status__in=[Call.RINGING, Call.ONGOING])
            to = int(to)
        except (Call.DoesNotExist, TypeError, ValueError):
            return None
        pair = {self.user.id, to}
        members = set(Membership.objects.filter(conversation_id=call.conversation_id, user_id__in=pair).values_list('user_id', flat=True))
        if pair - members:
            members |= set(CallInvite.objects.filter(call=call, user_id__in=pair).values_list('user_id', flat=True))
        return to if to != self.user.id and members == pair else None

    async def chat_event(self, event):
        # ("وصلت ✓✓" يتسجل مرة وحدة وقت الإرسال لكل المتصلين، مو هنا لكل جهاز)
        await self.send_json(event['payload'])

    @database_sync_to_async
    def came_online(self):
        """+1 اتصال، متصل الآن، والرسائل اللي جاته وهو مطفي صارت "وصلت" ✓✓. يرجع (أول اتصال؟، معارفه)."""
        now = timezone.now()
        if not Profile.objects.filter(user=self.user).update(
                connections=F('connections') + 1, is_online=True, last_seen=now):
            Profile.objects.create(user=self.user, connections=1, is_online=True, last_seen=now)
        count = Profile.objects.filter(user=self.user).values_list('connections', flat=True).first()
        mark_delivered(self.user)
        return count == 1, presence_audience(self.user.id, self.privacy_level())

    @database_sync_to_async
    def went_offline(self):
        """-1 اتصال. إذا ما بقى ولا جهاز: غير متصل ونرجع معارفه (حتى نبلغهم)، وإلا None."""
        Profile.objects.filter(user=self.user).update(connections=Greatest(F('connections') - 1, 0))
        if Profile.objects.filter(user=self.user, connections__gt=0).exists():
            return None
        Profile.objects.filter(user=self.user).update(is_online=False, last_seen=timezone.now())
        return presence_audience(self.user.id, self.privacy_level())

    def privacy_level(self):
        # الملف الشخصي محمّل مع المستخدم عند التحقق من التوكن (accounts/tokens.py)
        return getattr(getattr(self.user, 'profile', None), 'privacy_last_seen', None)
