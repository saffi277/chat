"""
لوحة الإدارة داخل التطبيق (الإعدادات ← لوحة الإدارة): ما يحتاجه مدير النظام يومياً، بالعربية وبتصميم التطبيق،
بدل صفحة /admin التقنية التي تعرض كل جداول النظام. لمن له صلاحية الإدارة فقط (is_staff).
  GET  /api/manage/                    ما ينتظر المدير: طلبات الأدوار، والبلاغات، وطلبات المساعدة، وأرقام سريعة
  POST /api/manage/roles/<user_id>/    {"approve": true|false} قبول الدور المطلوب أو رفضه (يبقى طالباً)
  POST /api/manage/reports/<id>/       تمت مراجعة البلاغ
  POST /api/manage/support/<id>/       تم حل الطلب، ومعه {"password": "..."} لتعيين كلمة مرور جديدة لصاحبه
"""
from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response

from .models import Profile, Report, SupportRequest
from .serializers import iso, profile_of
from .views import find_user

User = get_user_model()


def person(user):
    if not user:
        return None
    p = profile_of(user)
    return {'id': user.id, 'username': user.username, 'display_name': p.display_name, 'university_id': p.university_id,
            'email': user.email, 'role': p.role, 'requested_role': p.requested_role, 'joined': iso(user.date_joined)}


@api_view(['GET'])
@permission_classes([IsAdminUser])
def overview(request):
    requests = (Profile.objects.exclude(requested_role='').select_related('user').order_by('user__date_joined'))
    reports = Report.objects.filter(handled=False).select_related('reporter__profile', 'user__profile')[:100]
    support = SupportRequest.objects.filter(handled=False).select_related('user__profile').order_by('created_at')[:100]
    return Response({
        'stats': {'users': User.objects.filter(is_active=True).count(),
                  'online': Profile.objects.filter(connections__gt=0).count()},
        'role_requests': [person(p.user) for p in requests],
        'reports': [{'id': r.id, 'reason': r.reason, 'user': person(r.user), 'reporter': person(r.reporter),
                     'message_text': r.message_text, 'details': r.details, 'created_at': iso(r.created_at)}
                    for r in reports],
        'support': [{'id': s.id, 'kind': s.kind, 'identifier': s.identifier, 'contact': s.contact, 'message': s.message,
                     'user': person(s.user or (find_user(s.identifier) if s.identifier else None)),
                     'created_at': iso(s.created_at)} for s in support],
    })


@api_view(['POST'])
@permission_classes([IsAdminUser])
def decide_role(request, user_id):
    p = get_object_or_404(Profile, user_id=user_id)
    if not p.requested_role:
        raise ValidationError(_('لا يوجد طلب دور لهذا الحساب'))
    if request.data.get('approve'):
        p.role = p.requested_role
    p.requested_role = ''
    p.save(update_fields=['role', 'requested_role'])
    return Response(person(p.user))


@api_view(['POST'])
@permission_classes([IsAdminUser])
def report_done(request, pk):
    Report.objects.filter(pk=pk).update(handled=True)
    return Response({'ok': True})


@api_view(['POST'])
@permission_classes([IsAdminUser])
def support_done(request, pk):
    s = get_object_or_404(SupportRequest, pk=pk)
    password = request.data.get('password') or ''
    if password:
        user = s.user or (find_user(s.identifier) if s.identifier else None)
        if not user:
            raise ValidationError(_('لم نجد حساباً بهذا المعرّف. تأكد من الرقم الجامعي أو البريد أو اسم المستخدم'))
        if len(password) < 6:  # القاعدة نفسها عند إنشاء الحساب
            raise ValidationError({'password': _('كلمة المرور قصيرة: 6 أحرف على الأقل')})
        user.set_password(password)
        user.save(update_fields=['password'])
    s.handled = True
    s.save(update_fields=['handled'])
    return Response({'ok': True})
