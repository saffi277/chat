from django.contrib import admin
from django.urls import include, path, re_path

from .media import media

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/', include('chat.urls')),
    path('api/', include('notifications.urls')),
    # الملفات المرفوعة. بالإنتاج Nginx (أو خدمة تخزين) يقدمها قبل ما توصل لـ Django
    re_path(r'^media/(?P<path>.*)$', media),
]
