from django.urls import path

from . import views

urlpatterns = [
    path('conversations/', views.conversations),
    path('conversations/saved/', views.saved),
    path('conversations/groups/', views.create_group),
    path('conversations/<int:pk>/', views.conversation_detail),
    path('conversations/<int:pk>/members/', views.members),
    path('conversations/<int:pk>/members/<int:user_id>/', views.member_detail),
    path('conversations/<int:pk>/messages/', views.messages),
    path('conversations/<int:pk>/read/', views.mark_read),
    path('conversations/<int:pk>/media/', views.shared_media),
    path('messages/<int:message_id>/', views.message_detail),
    path('messages/<int:message_id>/location/', views.live_location),
]
