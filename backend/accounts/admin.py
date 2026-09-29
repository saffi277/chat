from django.contrib import admin

from .models import Block, Contact, Profile, Report, SupportRequest


class PendingRoleFilter(admin.SimpleListFilter):
    title = 'طلبات الدور'
    parameter_name = 'pending'

    def lookups(self, request, model_admin):
        return [('yes', 'بانتظار الاعتماد')]

    def queryset(self, request, queryset):
        return queryset.exclude(requested_role='') if self.value() == 'yes' else queryset


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    """
    من سجّل «تدريسياً» أو «إدارياً» يظهر هنا بطلب معلّق (فلتر «بانتظار الاعتماد»).
    بعد التحقق من هويته: حدّده ثم «اعتماد الدور المطلوب»، أو «رفض طلب الدور» فيبقى طالباً.
    """

    list_display = ['user', 'display_name', 'role', 'requested_role', 'university_id', 'is_online']
    list_filter = [PendingRoleFilter, 'role']
    search_fields = ['user__username', 'user__email', 'display_name', 'university_id']
    actions = ['approve_role', 'reject_role']

    @admin.action(description='اعتماد الدور المطلوب')
    def approve_role(self, request, queryset):
        n = 0
        for p in queryset.exclude(requested_role=''):
            p.role, p.requested_role = p.requested_role, ''
            p.save(update_fields=['role', 'requested_role'])
            n += 1
        self.message_user(request, f'اعتُمد الدور لـ {n} حساب')

    @admin.action(description='رفض طلب الدور (يبقى طالباً)')
    def reject_role(self, request, queryset):
        queryset.update(requested_role='')


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


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    """بلاغات المستخدمين. نص الرسالة محفوظ كما كان وقت البلاغ."""

    list_display = ['reason', 'user', 'reporter', 'created_at', 'handled']
    list_filter = ['reason', 'handled']
    list_editable = ['handled']
    search_fields = ['user__username', 'reporter__username', 'details', 'message_text']
    raw_id_fields = ['reporter', 'user', 'conversation', 'message']


@admin.register(Block)
class BlockAdmin(admin.ModelAdmin):
    list_display = ['blocker', 'blocked', 'created_at']
    search_fields = ['blocker__username', 'blocked__username']
    raw_id_fields = ['blocker', 'blocked']
