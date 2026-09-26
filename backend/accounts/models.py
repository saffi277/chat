from django.conf import settings
from django.db import models


class Profile(models.Model):
    """معلومات إضافية لكل مستخدم. جدول users الأساسي يجي جاهز من Django."""

    # OneToOne = كل مستخدم إله Profile واحد بس (Foreign Key فريد)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='profile')
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'{self.user.username} profile'
