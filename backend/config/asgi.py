"""
نقطة دخول السيرفر. نوزع الاتصالات حسب نوعها:
- http      → Django العادي (الـ API)
- websocket → Channels (الشات المباشر)
"""
import os
import sys

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django_app = get_asgi_application()  # لازم قبل استيراد أي شي يستخدم الموديلز

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402


# السيرفر هسه اشتغل، فماكو أي اتصال مفتوح: نصفّر عدادات "متصل".
# بالإنتاج (عدة عمال) نسويها مرة وحدة قبل ما يشتغلون: python manage.py reset_presence
# ونطفيها هنا بـ RESET_PRESENCE_ON_START=0، حتى عامل يعيد تشغيله ما يصفّر اتصالات الباقين.
if os.environ.get('RESET_PRESENCE_ON_START', '1') == '1':
    from accounts.presence import reset_presence
    reset_presence()

# العامل الخلفي (الرسائل المجدولة والمختفية) داخل هذه العملية. إن شغّلته عملية مستقلة
# (python manage.py run_worker) فأطفئه هنا بـ RUN_WORKER=0. وتشغيله في أكثر من عامل آمن (chat/worker.py).
# (لا يعمل أثناء الاختبارات: تستدعي دوال العامل بنفسها)
if os.environ.get('RUN_WORKER', '1') == '1' and sys.argv[1:2] != ['test']:
    from chat import worker
    worker.start()

from chat.auth import TokenAuthMiddleware  # noqa: E402
from chat.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_app,
    'websocket': TokenAuthMiddleware(URLRouter(websocket_urlpatterns)),
})
