from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


def default_expiry():
    return timezone.now() + timedelta(hours=24)


class Story(models.Model):
    """الحالة/القصة: صورة أو فيديو أو نص، تختفي بعد 24 ساعة."""

    IMAGE, VIDEO, TEXT = 'image', 'video', 'text'

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='stories')
    kind = models.CharField(max_length=10, choices=[(IMAGE, 'صورة'), (VIDEO, 'فيديو'), (TEXT, 'نص')])
    file = models.FileField(upload_to='stories/', blank=True, null=True)
    text = models.CharField(max_length=500, blank=True)  # نص الحالة، أو تعليق على الصورة
    background = models.CharField(max_length=9, blank=True)  # لون خلفية حالة النص مثل #5b5cf0
    duration = models.FloatField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(default=default_expiry)

    class Meta:
        ordering = ['created_at']


class StoryView(models.Model):
    """منو شاف الحالة وإيمتى (صاحب الحالة يشوف القائمة)."""

    story = models.ForeignKey(Story, on_delete=models.CASCADE, related_name='views')
    viewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['story', 'viewer'], name='unique_story_view')]
