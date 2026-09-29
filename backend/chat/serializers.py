from types import SimpleNamespace

from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import serializers

from accounts.privacy import sender_json, viewer_for
from accounts.serializers import UserSerializer, iso, profile_of, user_json


def no_read(viewer, receipts):
    """علامات القراءة متبادلة (كما في واتساب): من أوقفها لا يرى قراءة الآخرين لرسائله."""
    if receipts is None or profile_of(viewer).read_receipts:
        return receipts
    return [{'no_read': True}, *receipts]
from config.media import signed_url

from .models import Conversation, Membership, Message


def message_status(message, receipts):
    """
    ✓ sent: وصل للسيرفر   ✓✓ delivered: وصل لأجهزة الكل   ✓✓ أزرق read: الكل قرأوه
    receipts = قائمة {user_id, last_delivered_id, last_read_id} لكل الأعضاء
    """
    if receipts is None:
        return 'read' if message.is_read else 'sent'
    if receipts and receipts[0].get('no_read'):  # المشاهد أوقف علامات القراءة: لا يرى قراءة الآخرين أيضاً
        receipts = [{**r, 'last_read_id': 0} for r in receipts[1:]]
    others = [r for r in receipts if r['user_id'] != message.sender_id]
    if not others:  # الرسائل المحفوظة
        return 'read'
    if all(r['last_read_id'] >= message.id for r in others):
        return 'read'
    if all(r['last_delivered_id'] >= message.id for r in others):
        return 'delivered'
    return 'sent'


def poll_json(message):
    """الاستطلاع: الخيارات وعدد الأصوات ومن صوّت لكل خيار (مثل التفاعلات: الواجهة تعرف صوتي منها)."""
    poll = getattr(message, 'poll', None)
    if poll is None:
        return None
    options = list(poll.options.prefetch_related('votes'))
    voters = {v.user_id for o in options for v in o.votes.all()}
    return {'multiple': poll.multiple, 'total_voters': len(voters),
            'options': [{'id': o.id, 'text': o.text, 'votes': len(o.votes.all()),
                         'voter_ids': [v.user_id for v in o.votes.all()]} for o in options]}


def pinned_json(conv):
    m = conv.pinned_message
    if not m or m.deleted_at:
        return None
    from .services import preview_text
    return {'id': m.id, 'kind': m.kind, 'sender_name': profile_of(m.sender).display_name or m.sender.username,
            'preview': preview_text(m)[:120]}


class ReplySerializer(serializers.ModelSerializer):
    """نسخة مختصرة من الرسالة اللي ردينا عليها (تطلع فوك الرد)."""

    sender_name = serializers.SerializerMethodField()
    preview = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'kind', 'sender_id', 'sender_name', 'preview']

    def get_sender_name(self, obj):
        profile = getattr(obj.sender, 'profile', None)
        return (profile.display_name if profile and profile.display_name else obj.sender.username)

    def get_preview(self, obj):
        from .services import preview_text
        return preview_text(obj)[:120]

    def to_representation(self, obj):
        return {'id': obj.id, 'kind': obj.kind, 'sender_id': obj.sender_id,
                'sender_name': self.get_sender_name(obj), 'preview': self.get_preview(obj)}


class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()
    reply_to = ReplySerializer(read_only=True)
    is_live = serializers.BooleanField(read_only=True)
    is_deleted = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ['id', 'conversation', 'sender', 'kind', 'content', 'file_url', 'file_name', 'file_size',
                  'duration', 'width', 'height', 'latitude', 'longitude', 'live_until', 'is_live', 'reply_to',
                  'created_at', 'edited_at', 'expires_at', 'is_deleted', 'status', 'is_read', 'reactions']

    def get_file_url(self, obj):
        # رابط موقّع ومؤقت (config/media.py): ينفتح بس للي وصلتله الرسالة
        return signed_url(obj.file.name) if obj.file else None

    def get_is_deleted(self, obj):
        return obj.deleted_at is not None

    def get_status(self, obj):
        return message_status(obj, self.context.get('receipts'))

    def get_is_read(self, obj):
        return self.get_status(obj) == 'read'

    def to_representation(self, obj):
        # نبني الـ JSON مباشرة (سريع). نفس الحقول بالضبط اللي بـ Meta.fields
        status = self.get_status(obj)
        return {
            'id': obj.id, 'conversation': obj.conversation_id, 'sender': sender_json(obj.sender), 'kind': obj.kind,
            'content': obj.content, 'file_url': self.get_file_url(obj), 'file_name': obj.file_name,
            'file_size': obj.file_size, 'duration': obj.duration, 'width': obj.width, 'height': obj.height, 'latitude': obj.latitude, 'longitude': obj.longitude,
            'live_until': iso(obj.live_until), 'is_live': obj.is_live,
            'reply_to': ReplySerializer(obj.reply_to).to_representation(obj.reply_to) if obj.reply_to_id and obj.reply_to else None,
            'created_at': iso(obj.created_at), 'edited_at': iso(obj.edited_at), 'expires_at': iso(obj.expires_at),
            'is_deleted': obj.deleted_at is not None,
            'status': status, 'is_read': status == 'read', 'reactions': self.get_reactions(obj),
            'forwarded': obj.forwarded, 'poll': poll_json(obj) if obj.kind == Message.POLL and not obj.deleted_at else None,
        }

    def get_reactions(self, obj):
        # [{emoji: "❤️", count: 2, user_ids: [3, 5]}]. نفس البيانات تنبث للكل، وكل واجهة تعرف "أني تفاعلت" من user_ids
        groups = {}
        for r in obj.reactions.all():
            groups.setdefault(r.emoji, []).append(r.user_id)
        return [{'emoji': e, 'count': len(ids), 'user_ids': ids} for e, ids in groups.items()]


class MemberSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)

    class Meta:
        model = Membership
        fields = ['user', 'role', 'joined_at']

    def to_representation(self, obj):
        viewer = self.context.get('viewer')
        return {'user': viewer.json(obj.user) if viewer else user_json(obj.user), 'role': obj.role, 'joined_at': iso(obj.joined_at)}


class ConversationSerializer(serializers.ModelSerializer):
    participants = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    avatar = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    my_role = serializers.SerializerMethodField()
    is_favorite = serializers.SerializerMethodField()
    is_muted = serializers.SerializerMethodField()
    is_archived = serializers.SerializerMethodField()
    is_pinned = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ['id', 'kind', 'title', 'description', 'avatar', 'participants', 'member_count', 'my_role',
                  'is_favorite', 'is_muted', 'is_archived', 'is_pinned', 'last_message', 'unread_count', 'created_at']

    def _memberships(self, obj):
        # نحفظها على الكائن حتى ما نسأل الداتابيس كل مرة.
        # إذا القائمة جاية ويا prefetch (قائمة المحادثات) نستخدمها بدون استعلام جديد
        if not hasattr(obj, '_members_cache'):
            if 'memberships' in getattr(obj, '_prefetched_objects_cache', {}):
                obj._members_cache = sorted(obj.memberships.all(), key=lambda m: (m.joined_at, m.id))
            else:
                obj._members_cache = list(obj.memberships.select_related('user__profile').order_by('joined_at', 'id'))
        return obj._members_cache

    def _mine(self, obj):
        if hasattr(obj, 'my_role'):  # قائمة المحادثات: إعداداتي محسوبة بالاستعلام
            return SimpleNamespace(role=obj.my_role, is_favorite=obj.my_favorite, is_muted=obj.my_muted,
                                   muted_until=obj.my_muted_until, wallpaper=obj.my_wallpaper or '',
                                   is_archived=obj.my_archived, is_pinned=obj.pinned, cleared_at=obj.cleared,
                                   last_read_id=obj.my_read, user_id=self.context['request'].user.id)
        me = self.context['request'].user
        if obj.kind == Conversation.CHANNEL:  # لا نحمّل آلاف المشتركين لنجد صفّي
            if not hasattr(obj, '_my_row'):
                obj._my_row = obj.memberships.filter(user=me).first()
            return obj._my_row
        return next((m for m in self._memberships(obj) if m.user_id == me.id), None)

    def _receipts(self, obj):
        if obj.kind == Conversation.CHANNEL:
            return None  # القناة بلا علامات قراءة
        if obj.kind == Conversation.GROUP and hasattr(obj, 'others_read'):
            # بدل كل الأعضاء: "أقل واحد قرا/وصله" يكفي حتى نعرف ✓ أو ✓✓ أو ✓✓ أزرق لرسالتي
            if obj.others_read is None:
                return []
            return [{'user_id': 0, 'last_read_id': obj.others_read, 'last_delivered_id': obj.others_delivered}]
        rows = [{'user_id': m.user_id, 'last_delivered_id': m.last_delivered_id,
                 'last_read_id': m.last_read_id if profile_of(m.user).read_receipts else 0}
                for m in self._memberships(obj)]
        return no_read(self.context['request'].user, rows)

    def to_representation(self, obj):
        mine = self._mine(obj)
        admin = bool(mine and mine.role == Membership.ADMIN)
        return {
            **self.get_settings(obj, mine, admin),
            'pinned_message': pinned_json(obj) if obj.pinned_message_id else None,
            'id': obj.id, 'kind': obj.kind, 'title': self.get_title(obj), 'description': obj.description,
            'avatar': self.get_avatar(obj), 'participants': self.get_participants(obj),
            'member_count': self.get_member_count(obj), 'my_role': self.get_my_role(obj),
            'is_favorite': self.get_is_favorite(obj), 'is_muted': self.get_is_muted(obj),
            'is_archived': self.get_is_archived(obj), 'is_pinned': self.get_is_pinned(obj),
            'last_message': self.get_last_message(obj), 'unread_count': self.get_unread_count(obj),
            'created_at': iso(obj.created_at),
        }

    def get_participants(self, obj):
        # بالقائمة: المجموعة ما نرجع أعضاءها (ممكن 40 أو 400 شخص بكل طلب). تفاصيلهم من /members/
        if obj.kind == Conversation.CHANNEL or (obj.kind == Conversation.GROUP and self.context.get('compact')):
            return []  # القناة: المشتركون خاصّون (والمشرفون من /members/)
        viewer = viewer_for(self.context['request'])
        return [viewer.json(m.user) for m in self._memberships(obj)]

    def get_title(self, obj):
        if obj.kind == Conversation.SAVED:
            return _('الرسائل المحفوظة')
        return obj.title  # بالمحادثة الثنائية فارغ: الواجهة تعرض اسم الطرف الثاني

    def get_avatar(self, obj):
        return obj.avatar.url if obj.avatar else None

    def get_member_count(self, obj):
        if hasattr(obj, 'n_members'):
            return obj.n_members
        if obj.kind == Conversation.CHANNEL:
            return obj.memberships.count()
        return len(self._memberships(obj))

    def get_my_role(self, obj):
        mine = self._mine(obj)
        return mine.role if mine else None

    def get_is_favorite(self, obj):
        mine = self._mine(obj)
        return bool(mine and mine.is_favorite)

    def get_is_muted(self, obj):
        # الكتم لمدة ينتهي وحده: بعد muted_until لا تُعدّ المحادثة مكتومة
        mine = self._mine(obj)
        return bool(mine and mine.is_muted and (mine.muted_until is None or mine.muted_until > timezone.now()))

    def get_settings(self, obj, mine, admin):
        """إعدادات المحادثة: الخاصة بي (الكتم حتى متى، والخلفية) والعامة (الرسائل المختفية وإعدادات المجموعة)."""
        muted = self.get_is_muted(obj)
        if obj.kind == Conversation.CHANNEL or (obj.kind == Conversation.GROUP and obj.only_admins_post):
            can_post = admin
        else:
            can_post = mine is not None
        data = {
            'muted_until': iso(mine.muted_until) if muted and mine.muted_until else None,
            'wallpaper': mine.wallpaper if mine else '',
            'disappear_after': obj.disappear_after,
            'only_admins_post': obj.only_admins_post, 'only_admins_edit': obj.only_admins_edit,
            'slow_mode': obj.slow_mode, 'can_post': can_post,
            'can_edit_info': admin or (obj.kind == Conversation.GROUP and not obj.only_admins_edit),
        }
        # رابط الدعوة للمشرفين فقط، وفي صفحة المحادثة لا في القائمة
        if admin and obj.kind == Conversation.GROUP and not self.context.get('compact'):
            data['invite_code'] = obj.invite_code
        return data

    def get_is_archived(self, obj):
        mine = self._mine(obj)
        return bool(mine and mine.is_archived)

    def get_is_pinned(self, obj):
        mine = self._mine(obj)
        return bool(mine and mine.is_pinned)

    def get_last_message(self, obj):
        mine = self._mine(obj)
        receipts = self._receipts(obj)
        bulk = self.context.get('last_messages')
        if bulk is not None:  # قائمة المحادثات: كل آخر الرسائل انجابت باستعلام واحد
            msg = bulk.get(getattr(obj, 'last_msg_id', None))
            return MessageSerializer(context={'receipts': receipts}).to_representation(msg) if msg else None
        qs = obj.messages.select_related('sender__profile', 'reply_to').prefetch_related('reactions')
        if mine and mine.cleared_at:
            qs = qs.filter(created_at__gt=mine.cleared_at)
        msg = qs.order_by('-id').first()
        if not msg:
            return None
        return MessageSerializer(context={'receipts': receipts}).to_representation(msg)

    def get_unread_count(self, obj):
        if hasattr(obj, 'unread'):  # محسوب بالاستعلام نفسه (قائمة المحادثات)
            return obj.unread or 0
        mine = self._mine(obj)
        if not mine:
            return 0
        return obj.messages.filter(id__gt=mine.last_read_id).exclude(sender_id=mine.user_id).count()
