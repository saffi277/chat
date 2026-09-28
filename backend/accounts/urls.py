from django.urls import path

from . import views

urlpatterns = [
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),
    path('auth/help/', views.help_request),
    path('users/', views.UserListView.as_view()),
    path('users/find/', views.find),
    path('users/<int:pk>/', views.user_detail),
    path('contacts/', views.contacts),
    path('contacts/<int:user_id>/', views.contact_detail),
]
