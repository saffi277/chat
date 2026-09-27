from django.urls import path

from . import views

urlpatterns = [
    path('stories/', views.stories),
    path('stories/<int:pk>/', views.story_detail),
    path('stories/<int:pk>/view/', views.view_story),
    path('stories/<int:pk>/viewers/', views.story_viewers),
]
