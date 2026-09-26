from django.urls import path

from . import views

urlpatterns = [
    path('conversations/', views.conversations),
    path('conversations/<int:pk>/messages/', views.messages),
    path('conversations/<int:pk>/read/', views.mark_read),
]
