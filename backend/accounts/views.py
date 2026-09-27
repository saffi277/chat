from django.contrib.auth import authenticate, get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from .models import Profile, SupportRequest
from .serializers import MeSerializer, ProfileUpdateSerializer, RegisterSerializer, UserSerializer

User = get_user_model()


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    # request.data = الـ JSON اللي دزته الواجهة بالـ body
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)  # إذا غلط يرجع 400 تلقائياً
    user = serializer.save()
    token = Token.objects.create(user=user)
    return Response({'token': token.key, 'user': MeSerializer(user).data}, status=status.HTTP_201_CREATED)


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
def login(request):
    """{"identifier": اسم المستخدم أو البريد أو الرقم الجامعي, "password": ..., "role": student|faculty|staff (اختياري)}"""
    found = find_user(request.data.get('identifier') or request.data.get('username'))
    user = found and authenticate(username=found.username, password=request.data.get('password'))
    if not user:
        return Response({'detail': 'بيانات الدخول غلط. تأكد من البريد أو الرقم الجامعي وكلمة المرور'},
                        status=status.HTTP_400_BAD_REQUEST)
    profile, _ = Profile.objects.get_or_create(user=user)
    role = request.data.get('role')
    if role and role != profile.role:
        # نتحقق بعد كلمة المرور، حتى ما نكشف دور أي حساب لأي أحد
        return Response({'detail': f'هذا الحساب مسجل كـ «{profile.get_role_display()}»، اختار الدور الصحيح',
                         'role': profile.role}, status=status.HTTP_400_BAD_REQUEST)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': MeSerializer(user).data})


@api_view(['GET', 'PATCH'])
def me(request):
    # request.user انعرف من الـ Token اللي بالـ Header
    if request.method == 'PATCH':
        profile, _ = Profile.objects.get_or_create(user=request.user)
        old_avatar = profile.avatar.name if profile.avatar else None
        # partial=True: نعدل بس الحقول اللي انرسلت
        serializer = ProfileUpdateSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # إذا تبدلت الصورة أو انمسحت، نمسح الملف القديم حتى ما يتكدس
        if old_avatar and old_avatar != (profile.avatar.name if profile.avatar else None):
            profile.avatar.storage.delete(old_avatar)
        request.user.refresh_from_db()
    return Response(MeSerializer(request.user).data)


class UserListView(generics.ListAPIView):
    """GET /api/users/ — كل المستخدمين عدا أنا."""

    serializer_class = UserSerializer

    def get_queryset(self):
        # SQL تقريباً: SELECT * FROM auth_user WHERE id != <me> ORDER BY username
        qs = User.objects.exclude(id=self.request.user.id).select_related('profile').order_by('username')
        q = self.request.query_params.get('q', '').strip()  # ?q= للبحث بالاسم أو الرقم
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(profile__display_name__icontains=q) | Q(profile__phone__icontains=q))
        return qs


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
        return Response({'kind': 'password أو support'}, status=status.HTTP_400_BAD_REQUEST)
    identifier = (request.data.get('identifier') or '').strip()[:150]
    contact = (request.data.get('contact') or '').strip()[:150]
    message = (request.data.get('message') or '').strip()[:2000]
    if kind == SupportRequest.PASSWORD and not identifier:
        return Response({'identifier': 'اكتب بريدك أو رقمك الجامعي'}, status=status.HTTP_400_BAD_REQUEST)
    if kind == SupportRequest.SUPPORT and not message:
        return Response({'message': 'اكتب شنو المشكلة'}, status=status.HTTP_400_BAD_REQUEST)
    SupportRequest.objects.create(kind=kind, identifier=identifier, contact=contact, message=message,
                                  user=find_user(identifier))
    # نفس الجواب سواء لگينا الحساب أو لا، حتى ما نكشف منو مسجل
    return Response({'detail': 'وصل طلبك للدعم الفني، راح يتواصلون وياك قريباً'}, status=status.HTTP_201_CREATED)
