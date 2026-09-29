from django.urls import path

from . import features, views

urlpatterns = [
    path('conversations/', views.conversations),
    path('conversations/saved/', views.saved),
    path('conversations/groups/', views.create_group),
    path('channels/', views.channels),
    path('channels/<int:pk>/subscribe/', views.subscribe),
    path('conversations/<int:pk>/', views.conversation_detail),
    path('conversations/<int:pk>/members/', views.members),
    path('conversations/<int:pk>/members/<int:user_id>/', views.member_detail),
    path('conversations/<int:pk>/messages/', views.messages),
    path('conversations/<int:pk>/read/', views.mark_read),
    path('conversations/<int:pk>/media/', views.shared_media),
    path('conversations/<int:pk>/clear/', views.clear_conversation),
    path('conversations/<int:pk>/invite/', views.invite_link),
    path('conversations/<int:pk>/scheduled/', views.scheduled),
    path('scheduled/<int:sid>/', views.scheduled_detail),
    path('invite/<str:code>/', views.join_by_invite),
    path('messages/<int:message_id>/', views.message_detail),
    path('messages/<int:message_id>/location/', views.live_location),
    path('messages/<int:message_id>/react/', views.react),
    path('messages/<int:message_id>/star/', views.star),
    path('starred/', views.starred),
    path('messages/forward/', features.forward),
    path('messages/<int:message_id>/pin/', features.pin_message),
    path('messages/<int:message_id>/vote/', features.vote),
    path('search/', features.search),
    path('link-preview/', features.link_preview),
    path('folders/', features.folders),
    path('folders/<int:pk>/', features.folder_detail),
]
