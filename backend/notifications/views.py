from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import PushSubscription
from .vapid import get_keys


@api_view(['GET'])
@permission_classes([AllowAny])
def public_key(request):
    """المتصفح يحتاج المفتاح العام حتى يسوي الاشتراك."""
    return Response({'public_key': get_keys()[0]})


@api_view(['POST', 'DELETE'])
def subscribe(request):
    endpoint = request.data.get('endpoint')
    if not endpoint:
        return Response({'detail': 'endpoint مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        PushSubscription.objects.filter(endpoint=endpoint, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    keys = request.data.get('keys') or {}
    if not keys.get('p256dh') or not keys.get('auth'):
        return Response({'detail': 'keys ناقصة'}, status=status.HTTP_400_BAD_REQUEST)
    # نفس المتصفح ممكن يسجل دخول بحساب ثاني، فنربط الـ endpoint بالمستخدم الحالي
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={'user': request.user, 'p256dh': keys['p256dh'], 'auth': keys['auth']})
    return Response({'ok': True}, status=status.HTTP_201_CREATED)
