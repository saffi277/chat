from django.urls import path

from . import views

urlpatterns = [
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/me/', views.me),
    path('users/', views.UserListView.as_view()),
    path('users/<int:pk>/', views.user_detail),
]
