from django.contrib.auth import authenticate, get_user_model
from rest_framework import generics, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import Profile
from .serializers import RegisterSerializer, UserSerializer

User = get_user_model()


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    # request.data = الـ JSON اللي دزته الواجهة بالـ body
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)  # إذا غلط يرجع 400 تلقائياً
    user = serializer.save()
    Profile.objects.create(user=user)
    token = Token.objects.create(user=user)
    return Response({'token': token.key, 'user': UserSerializer(user).data}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):
    user = authenticate(username=request.data.get('username'), password=request.data.get('password'))
    if user is None:
        return Response({'detail': 'اسم المستخدم أو كلمة المرور غلط'}, status=status.HTTP_400_BAD_REQUEST)
    Profile.objects.get_or_create(user=user)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': UserSerializer(user).data})


@api_view(['GET'])
def me(request):
    # request.user انعرف من الـ Token اللي بالـ Header
    return Response(UserSerializer(request.user).data)


class UserListView(generics.ListAPIView):
    """GET /api/users/ — كل المستخدمين عدا أنا."""

    serializer_class = UserSerializer

    def get_queryset(self):
        # SQL تقريباً: SELECT * FROM auth_user WHERE id != <me> ORDER BY username
        return User.objects.exclude(id=self.request.user.id).select_related('profile').order_by('username')
