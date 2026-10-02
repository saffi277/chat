from django.urls import path

from . import views

urlpatterns = [
    path('calls/', views.calls),
    path('calls/ice/', views.ice),
    path('calls/ringing/', views.ringing),
    path('calls/active/', views.active),
    path('calls/<int:pk>/leave/', views.leave),
    path('calls/<int:pk>/video/', views.upgrade_video),
    path('calls/<int:pk>/answer/', views.answer),
    path('calls/<int:pk>/decline/', views.decline),
    path('calls/<int:pk>/end/', views.end),
    path('calls/<int:pk>/invite/', views.invite),
]
