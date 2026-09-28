from django.urls import path

from . import views

urlpatterns = [
    path('push/key/', views.public_key),
    path('push/subscribe/', views.subscribe),
    path('push/test/', views.test),
]
