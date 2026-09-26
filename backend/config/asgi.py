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

from chat.auth import TokenAuthMiddleware  # noqa: E402
from chat.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_app,
    'websocket': TokenAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
