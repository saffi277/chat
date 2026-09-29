from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from .fields import EncryptedTextField, get_encrypted_storage


class Conversation(models.Model):
    """
    محادثة: بين شخصين (direct)، أو مجموعة (group)، أو "الرسائل المحفوظة" (saved) وحدك،
    أو قناة (channel): ينشر فيها مشرفوها فقط (تدريسيون وإداريون)، والمشتركون يقرؤون ويتفاعلون.
    """

    DIRECT, GROUP, SAVED, CHANNEL = 'direct', 'group', 'saved', 'channel'
    KINDS = [(DIRECT, 'محادثة ثنائية'), (GROUP, 'مجموعة'), (SAVED, 'الرسائل المحفوظة'), (CHANNEL, 'قناة')]

    kind = models.CharField(max_length=10, choices=KINDS, default=DIRECT)
    # ManyToMany عن طريق جدول وسيط (Membership) حتى نحفظ معلومات لكل عضو: دوره، المفضلة، شكد قرا...
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL, through='Membership', related_name='conversations')
    # للمجموعات والقنوات فقط
    title = models.CharField(max_length=80, blank=True)
    description = models.CharField(max_length=300, blank=True)
    avatar = models.ImageField(upload_to='groups/', blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)
    # الرسائل المختفية: الرسالة الجديدة تُحذف بعد هذا العدد من الثواني (0 = لا تختفي). يحذفها chat/worker.py
    disappear_after = models.PositiveIntegerField(default=0)
    # إعدادات المجموعة (يغيّرها المشرفون)
    only_admins_post = models.BooleanField(default=False)  # الإرسال للمشرفين فقط
    only_admins_edit = models.BooleanField(default=True)   # تعديل الاسم والوصف والصورة للمشرفين فقط
    slow_mode = models.PositiveIntegerField(default=0)      # ثوانٍ بين رسالتين لكل عضو (0 = بلا حد)
    # رابط الدعوة: من يملكه ينضم إلى المجموعة. يُلغى بمسحه، ويتغيّر بإنشاء جديد
    invite_code = models.CharField(max_length=32, unique=True, null=True, blank=True)

    DISAPPEAR_CHOICES = (0, 24 * 3600, 7 * 24 * 3600, 90 * 24 * 3600)
    SLOW_CHOICES = (0, 10, 30, 60, 300, 900, 3600)


class Membership(models.Model):
    """صف لكل (مستخدم، محادثة): هنا نحفظ الأشياء الخاصة بكل عضو."""

    ADMIN, MEMBER = 'admin', 'member'

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=10, choices=[(ADMIN, 'مشرف'), (MEMBER, 'عضو')], default=MEMBER)
    is_favorite = models.BooleanField(default=False)
    is_muted = models.BooleanField(default=False)
    # الكتم لمدة (8 ساعات، أسبوع...): بعد هذا الوقت يعود الإشعار وحده. فارغ مع is_muted = كتم دائم
    muted_until = models.DateTimeField(null=True, blank=True)
    # خلفية هذه المحادثة عندي فقط (فارغ = خلفية الثيم العامة)
    wallpaper = models.CharField(max_length=20, blank=True)
    is_archived = models.BooleanField(default=False)
    is_pinned = models.BooleanField(default=False)  # 📌 تطلع فوك القائمة
    # "حذف المحادثة" عندي: الرسائل قبل هذا الوقت ما تطلعلي، والمحادثة تنخفي لحد ما تجي رسالة جديدة
    cleared_at = models.DateTimeField(null=True, blank=True)
    # آخر رسالة وصلت لجهازه، وآخر رسالة قراها. منها نحسب ✓ / ✓✓ / ✓✓ أزرق وعدد غير المقروء
    last_delivered_id = models.PositiveBigIntegerField(default=0)
    last_read_id = models.PositiveBigIntegerField(default=0)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['conversation', 'user'], name='unique_membership')]

    @property
    def muted_now(self):
        return self.is_muted and (self.muted_until is None or self.muted_until > timezone.now())


def message_upload_path(instance, filename):
    return f'messages/{instance.conversation_id}/{filename}'


class Message(models.Model):
    TEXT, IMAGE, VIDEO, VOICE, FILE, LOCATION, SYSTEM, CALL = (
        'text', 'image', 'video', 'voice', 'file', 'location', 'system', 'call')
    KINDS = [(TEXT, 'نص'), (IMAGE, 'صورة'), (VIDEO, 'فيديو'), (VOICE, 'رسالة صوتية'),
             (FILE, 'ملف'), (LOCATION, 'موقع'), (SYSTEM, 'رسالة نظام'), (CALL, 'مكالمة')]

    # ForeignKey = كل رسالة تنتمي لمحادثة وحدة ومرسل واحد
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='messages')
    kind = models.CharField(max_length=10, choices=KINDS, default=TEXT)
    # النص، أو تعليق على الصورة/الملف. ينحفظ مشفر (AES-256) بقاعدة البيانات: chat/crypto.py
    content = EncryptedTextField(blank=True)
    # نص الرسالة مشفر فما نكدر نبحث بيه بـ SQL، فنعلّم وقت الحفظ إذا بيها رابط (لتبويب "الروابط")
    has_link = models.BooleanField(default=False)
    # الوسائط: الملف ينحفظ بـ media/messages/<id>/ والداتابيس تحفظ مساره
    file = models.FileField(upload_to=message_upload_path, blank=True, null=True, storage=get_encrypted_storage)
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)  # بالثواني، للصوت والفيديو
    # أبعاد الصورة أو الفيديو: يحجز المستقبل مكانها بالقياس الصحيح قبل أن تكتمل
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    # الموقع
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    live_until = models.DateTimeField(null=True, blank=True)  # إذا موقع مباشر: لحد إيمتى يتحدث
    reply_to = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies')
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # الرسائل المختفية: وقت حذفها (من Conversation.disappear_after لحظة الإرسال)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # للمحادثات الثنائية: الطرف الثاني قراها. (بالمجموعات نستخدم Membership.last_read_id)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at', 'id']
        # أكثر استعلام: "آخر رسائل هاي المحادثة" و"آخر رسالة" → فهرس مركب يخليها فورية حتى ويا ملايين الرسائل
        indexes = [models.Index(fields=['conversation', '-id'], name='msg_conv_id_desc')]

    @property
    def is_live(self):
        return bool(self.live_until and self.live_until > timezone.now())

    def save(self, *args, **kwargs):
        self.has_link = self.kind == self.TEXT and ('http://' in self.content or 'https://' in self.content)
        fields = kwargs.get('update_fields')
        if fields is not None and 'content' in fields and 'has_link' not in fields:
            kwargs['update_fields'] = [*fields, 'has_link']
        super().save(*args, **kwargs)

    def live_for(self, minutes):
        self.live_until = timezone.now() + timedelta(minutes=minutes)


class Reaction(models.Model):
    """تفاعل على رسالة (❤️ 👍 ...). كل شخص إله تفاعل واحد على الرسالة."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='reactions')
    emoji = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['message', 'user'], name='one_reaction_per_user')]


class StarredMessage(models.Model):
    """الرسائل المميزة ⭐: خاصة بكل مستخدم (الطرف الثاني ما يدري)."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='stars')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='starred')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['message', 'user'], name='unique_star')]


class ScheduledMessage(models.Model):
    """
    رسالة نصية مجدولة: تُرسل وحدها في وقتها (chat/worker.py يفحص كل 15 ثانية).
    الحالة تمنع إرسالها مرتين إن عمل أكثر من عامل: من يغيّر pending إلى sending أولاً هو من يرسلها.
    """

    PENDING, SENDING, FAILED = 'pending', 'sending', 'failed'

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='scheduled')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='scheduled')
    content = EncryptedTextField()
    reply_to = models.ForeignKey(Message, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    send_at = models.DateTimeField(db_index=True)
    silent = models.BooleanField(default=False)  # دون إشعار
    status = models.CharField(max_length=10, default=PENDING,
                              choices=[(PENDING, 'بانتظار موعدها'), (SENDING, 'تُرسل'), (FAILED, 'تعذّر إرسالها')])
    error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['send_at', 'id']
