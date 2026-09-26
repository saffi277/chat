from django.conf import settings
from django.db import models


class Conversation(models.Model):
    """محادثة بين شخصين (أو أكثر مستقبلاً)."""

    # ManyToMany = جدول وسيط يربط المحادثات بالمستخدمين
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)


class Message(models.Model):
    # ForeignKey = كل رسالة تنتمي لمحادثة وحدة ومرسل واحد
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='messages')
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at']
