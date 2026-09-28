from django.contrib.auth import authenticate, get_user_model
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from rest_framework import generics, serializers, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from config.throttles import LoginThrottle

from .models import Profile, SupportRequest
from .serializers import MeSerializer, ProfileUpdateSerializer, RegisterSerializer, UserSerializer
from .tokens import issue_token

User = get_user_model()


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def register(request):
    # request.data = الـ JSON اللي دزته الواجهة بالـ body
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)  # إذا غلط يرجع 400 تلقائياً
    user = serializer.save()
    token = issue_token(user, request.META.get('HTTP_USER_AGENT', ''))
    return Response({'token': token, 'user': MeSerializer(user).data}, status=status.HTTP_201_CREATED)


def find_user(identifier):
    """نلگى الحساب بأي وحدة: اسم المستخدم، أو البريد الجامعي، أو الرقم الجامعي."""
    identifier = (identifier or '').strip()
    if not identifier:
        return None
    return (User.objects.filter(username__iexact=identifier).first()
            or User.objects.filter(email__iexact=identifier).first()
            or User.objects.filter(profile__university_id__iexact=identifier).first())


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login(request):
    """{"identifier": اسم المستخدم أو البريد أو الرقم الجامعي, "password": ..., "role": student|faculty|staff (اختياري)}"""
    found = find_user(request.data.get('identifier') or request.data.get('username'))
    user = found and authenticate(username=found.username, password=request.data.get('password'))
    if not user:
        return Response({'detail': _('بيانات الدخول غير صحيحة. تحقّق من البريد أو الرقم الجامعي وكلمة المرور')},
                        status=status.HTTP_400_BAD_REQUEST)
    profile, _created = Profile.objects.get_or_create(user=user)
    role = request.data.get('role')
    if role and role != profile.role:
        # نتحقق بعد كلمة المرور، حتى ما نكشف دور أي حساب لأي أحد
        return Response({'detail': _('هذا الحساب مسجّل بدور «{role}»، اختر الدور الصحيح').format(role=_(profile.get_role_display())),
                         'role': profile.role}, status=status.HTTP_400_BAD_REQUEST)
    # كل دخول (كل جهاز) إله توكن جديد، ونحفظ الهاش مالته بس
    token = issue_token(user, request.META.get('HTTP_USER_AGENT', ''))
    return Response({'token': token, 'user': MeSerializer(user).data})


@api_view(['POST'])
def logout(request):
    """تسجيل الخروج: نمسح توكن هذا الجهاز من السيرفر (مو بس من المتصفح). {"all": true} = من كل الأجهزة."""
    if request.data.get('all'):
        request.user.auth_tokens.all().delete()
    elif request.auth is not None:
        request.auth.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'PATCH'])
def me(request):
    # request.user انعرف من الـ Token اللي بالـ Header
    if request.method == 'PATCH':
        profile, _created = Profile.objects.get_or_create(user=request.user)
        old_avatar = profile.avatar.name if profile.avatar else None
        # partial=True: نعدل بس الحقول اللي انرسلت
        serializer = ProfileUpdateSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        # البريد الجامعي في جدول المستخدم لا الملف الشخصي: نتحقق منه قبل حفظ أي شيء
        email = request.data.get('email') if hasattr(request.data, 'get') else None
        if email is not None:
            email = serializers.EmailField(allow_blank=True).run_validation(str(email).strip())
            if email and User.objects.filter(email__iexact=email).exclude(pk=request.user.pk).exists():
                raise ValidationError({'email': _('هذا البريد مسجّل بحساب آخر')})
        serializer.save()
        if email is not None and email != request.user.email:
            request.user.email = email
            request.user.save(update_fields=['email'])
        # إذا تبدلت الصورة أو انمسحت، نمسح الملف القديم حتى ما يتكدس
        if old_avatar and old_avatar != (profile.avatar.name if profile.avatar else None):
            profile.avatar.storage.delete(old_avatar)
        request.user.refresh_from_db()
    return Response(MeSerializer(request.user).data)


class UserListView(generics.ListAPIView):
    """
    GET /api/users/?q=بحث&limit=50&offset=0 — المستخدمين عدا أنا.
    بالجامعة آلاف المستخدمين، فما نرجعهم كلهم: 50 بالمرة (وأقصى شي 200)، واللي تحچي وياهم يطلعون أول.
    """

    serializer_class = UserSerializer

    def get_queryset(self):
        from chat.models import Membership
        me = self.request.user
        my_convs = Membership.objects.filter(user=me).values('conversation_id')
        is_contact = Exists(Membership.objects.filter(user=OuterRef('pk'), conversation_id__in=my_convs))
        qs = (User.objects.exclude(id=me.id).select_related('profile')
              .annotate(contact=is_contact).order_by('-contact', 'profile__display_name', 'username'))
        q = self.request.query_params.get('q', '').strip()  # ?q= بالاسم أو الرقم أو الرقم الجامعي
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(profile__display_name__icontains=q)
                           | Q(profile__phone__icontains=q) | Q(profile__university_id__iexact=q))
        return qs

    def list(self, request, *args, **kwargs):
        try:
            limit = max(1, min(int(request.query_params.get('limit', 50)), 200))
            offset = max(0, int(request.query_params.get('offset', 0)))
        except ValueError:
            limit, offset = 50, 0
        page = self.get_queryset()[offset:offset + limit]
        return Response(self.get_serializer(page, many=True).data)


@api_view(['GET'])
def user_detail(request, pk):
    """صفحة جهة الاتصال."""
    return Response(UserSerializer(get_object_or_404(User.objects.select_related('profile'), pk=pk)).data)


class HelpThrottle(AnonRateThrottle):
    rate = '10/hour'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([HelpThrottle])
def help_request(request):
    """من صفحة الدخول: {"kind": "password"|"support", "identifier", "contact", "message"}.
    الطلب يوصل للإداري بلوحة الإدارة (/admin)، وهو يعيّن رمز جديد أو يتواصل ويا صاحبه."""
    kind = request.data.get('kind')
    if kind not in (SupportRequest.PASSWORD, SupportRequest.SUPPORT):
        return Response({'kind': 'password | support'}, status=status.HTTP_400_BAD_REQUEST)
    identifier = (request.data.get('identifier') or '').strip()[:150]
    contact = (request.data.get('contact') or '').strip()[:150]
    message = (request.data.get('message') or '').strip()[:2000]
    if kind == SupportRequest.PASSWORD and not identifier:
        return Response({'identifier': _('اكتب بريدك أو رقمك الجامعي')}, status=status.HTTP_400_BAD_REQUEST)
    if kind == SupportRequest.SUPPORT and not message:
        return Response({'message': _('اكتب المشكلة')}, status=status.HTTP_400_BAD_REQUEST)
    SupportRequest.objects.create(kind=kind, identifier=identifier, contact=contact, message=message,
                                  user=find_user(identifier))
    # نفس الجواب سواء لگينا الحساب أو لا، حتى ما نكشف منو مسجل
    return Response({'detail': _('وصل طلبك إلى الدعم الفني، وسيتواصلون معك قريباً')}, status=status.HTTP_201_CREATED)
