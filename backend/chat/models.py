from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class Conversation(models.Model):
    """محادثة: بين شخصين (direct)، أو مجموعة (group)، أو "الرسائل المحفوظة" (saved) وحدك."""

    DIRECT, GROUP, SAVED = 'direct', 'group', 'saved'
    KINDS = [(DIRECT, 'محادثة ثنائية'), (GROUP, 'مجموعة'), (SAVED, 'الرسائل المحفوظة')]

    kind = models.CharField(max_length=10, choices=KINDS, default=DIRECT)
    # ManyToMany عن طريق جدول وسيط (Membership) حتى نحفظ معلومات لكل عضو: دوره، المفضلة، شكد قرا...
    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL, through='Membership', related_name='conversations')
    # للمجموعات بس
    title = models.CharField(max_length=80, blank=True)
    description = models.CharField(max_length=300, blank=True)
    avatar = models.ImageField(upload_to='groups/', blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)


class Membership(models.Model):
    """صف لكل (مستخدم، محادثة): هنا نحفظ الأشياء الخاصة بكل عضو."""

    ADMIN, MEMBER = 'admin', 'member'

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='memberships')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=10, choices=[(ADMIN, 'مشرف'), (MEMBER, 'عضو')], default=MEMBER)
    is_favorite = models.BooleanField(default=False)
    is_muted = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    # آخر رسالة وصلت لجهازه، وآخر رسالة قراها. منها نحسب ✓ / ✓✓ / ✓✓ أزرق وعدد غير المقروء
    last_delivered_id = models.PositiveBigIntegerField(default=0)
    last_read_id = models.PositiveBigIntegerField(default=0)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['conversation', 'user'], name='unique_membership')]


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
    content = models.TextField(blank=True)  # النص، أو تعليق على الصورة/الملف
    # الوسائط: الملف ينحفظ بـ media/messages/<id>/ والداتابيس تحفظ مساره
    file = models.FileField(upload_to=message_upload_path, blank=True, null=True)
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.PositiveBigIntegerField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)  # بالثواني، للصوت والفيديو
    # الموقع
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    live_until = models.DateTimeField(null=True, blank=True)  # إذا موقع مباشر: لحد إيمتى يتحدث
    reply_to = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='replies')
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # للمحادثات الثنائية: الطرف الثاني قراها. (بالمجموعات نستخدم Membership.last_read_id)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at', 'id']

    @property
    def is_live(self):
        return bool(self.live_until and self.live_until > timezone.now())

    def live_for(self, minutes):
        self.live_until = timezone.now() + timedelta(minutes=minutes)
