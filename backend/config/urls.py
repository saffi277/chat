from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/', include('chat.urls')),
    path('api/', include('notifications.urls')),
]

# بالتطوير Django يقدم الصور المرفوعة بنفسه. بالإنتاج هذا شغل Nginx أو خدمة تخزين.
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
