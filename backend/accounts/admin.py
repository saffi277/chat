from django.contrib import admin

from .models import Contact, Profile, SupportRequest


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'display_name', 'role', 'university_id', 'is_online']
    list_filter = ['role']
    search_fields = ['user__username', 'user__email', 'display_name', 'university_id']


@admin.register(SupportRequest)
class SupportRequestAdmin(admin.ModelAdmin):
    """طلبات نسيت كلمة المرور والدعم الفني. لتغيير رمز حساب: المستخدمين ← الحساب ← "تغيير كلمة المرور"."""

    list_display = ['kind', 'identifier', 'user', 'contact', 'created_at', 'handled']
    list_filter = ['kind', 'handled']
    list_editable = ['handled']
    search_fields = ['identifier', 'contact', 'message']
    actions = ['mark_handled']

    @admin.action(description='تم الحل')
    def mark_handled(self, request, queryset):
        queryset.update(handled=True)


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ['owner', 'contact', 'created_at']
    search_fields = ['owner__username', 'contact__username']
    raw_id_fields = ['owner', 'contact']
