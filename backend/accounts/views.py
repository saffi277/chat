from django.contrib.auth import authenticate, get_user_model
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Profile
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


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(username=request.data.get('username'), password=request.data.get('password'))
    if user is None:
        return Response({'detail': 'اسم المستخدم أو كلمة المرور غلط'}, status=status.HTTP_400_BAD_REQUEST)
    Profile.objects.get_or_create(user=user)
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
