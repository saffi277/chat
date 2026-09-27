"""
نقطة دخول السيرفر. نوزع الاتصالات حسب نوعها:
- http      → Django العادي (الـ API)
- websocket → Channels (الشات المباشر)
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django_app = get_asgi_application()  # لازم قبل استيراد أي شي يستخدم الموديلز

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402


def reset_presence():
    # السيرفر هسه اشتغل، فماكو أي اتصال مفتوح. نصفّر العدادات حتى محد يبقى "متصل" غلط
    # بعد ما السيرفر طفى فجأة. (إذا صار عدنا أكثر من سيرفر، هذا ينتقل لـ Redis)
    from django.db import DatabaseError

    from accounts.models import Profile
    try:
        Profile.objects.filter(connections__gt=0).update(connections=0, is_online=False)
    except DatabaseError:
        pass  # الجداول بعد ما انسوت (قبل migrate)


reset_presence()

from chat.auth import TokenAuthMiddleware  # noqa: E402
from chat.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_app,
    'websocket': TokenAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
