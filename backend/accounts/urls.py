from django.urls import path

from . import manage_views, views

urlpatterns = [
    path('auth/register/', views.register),
    path('auth/login/', views.login),
    path('auth/login/two-step/', views.login_two_step),
    path('auth/two-step/', views.two_step),
    path('auth/sessions/', views.sessions),
    path('auth/sessions/<int:pk>/', views.session_detail),
    path('auth/delete/', views.delete_account),
    path('blocks/', views.blocks),
    path('blocks/<int:user_id>/', views.block_detail),
    path('reports/', views.report),
    path('auth/logout/', views.logout),
    path('auth/me/', views.me),
    path('auth/help/', views.help_request),
    path('users/', views.UserListView.as_view()),
    path('users/find/', views.find),
    path('users/<int:pk>/', views.user_detail),
    path('contacts/', views.contacts),
    path('contacts/<int:user_id>/', views.contact_detail),
    # لوحة الإدارة داخل التطبيق (لمن له صلاحية الإدارة)
    path('manage/', manage_views.overview),
    path('manage/roles/<int:user_id>/', manage_views.decide_role),
    path('manage/reports/<int:pk>/', manage_views.report_done),
    path('manage/support/<int:pk>/', manage_views.support_done),
]
