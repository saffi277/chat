from django.conf import settings
from django.db import models


class PushSubscription(models.Model):
    """
    "عنوان" متصفح معين يوصله إشعار حتى لو التطبيق مسدود.
    المتصفح هو اللي يسوي هذا العنوان (endpoint) عند شركته (Google/Apple/Mozilla)،
    وإحنا نخزنه حتى ندزله الإشعار بعدين.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='push_subscriptions')
    endpoint = models.URLField(max_length=500, unique=True)
    # مفاتيح التشفير: الإشعار يوصل مشفّر، وبس هذا المتصفح يكدر يفكه
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True)

    def as_subscription_info(self):
        return {'endpoint': self.endpoint, 'keys': {'p256dh': self.p256dh, 'auth': self.auth}}
