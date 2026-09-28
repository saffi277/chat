import time

from rest_framework import status
from django.utils.translation import gettext as _
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import PushSubscription
from .push import send_test
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
        return Response({'detail': _('endpoint مطلوب')}, status=status.HTTP_400_BAD_REQUEST)
    if request.method == 'DELETE':
        PushSubscription.objects.filter(endpoint=endpoint, user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    keys = request.data.get('keys') or {}
    if not keys.get('p256dh') or not keys.get('auth'):
        return Response({'detail': _('keys ناقصة')}, status=status.HTTP_400_BAD_REQUEST)
    # نفس المتصفح ممكن يسجل دخول بحساب ثاني، فنربط الـ endpoint بالمستخدم الحالي
    PushSubscription.objects.update_or_create(
        endpoint=endpoint,
        defaults={'user': request.user, 'p256dh': keys['p256dh'], 'auth': keys['auth']})
    return Response({'ok': True}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def test(request):
    """
    إشعار تجريبي لأجهزتي (زر في الإعدادات). يعيد نتيجة كل جهاز حتى نعرف سبب عدم الوصول إن وُجد:
    {"results": [{"ok": true, "host": "web.push.apple.com", "status": 201, "reason": ""}]}
    {"delay": 5} = انتظر 5 ثوانٍ قبل الإرسال، ليغلق المستخدم التطبيق ويرى الإشعار كما يصل عادةً (بحد أقصى 10).
    """
    try:
        delay = min(max(int(request.data.get('delay') or 0), 0), 10)
    except (TypeError, ValueError):
        delay = 0
    time.sleep(delay)
    return Response({'results': send_test(request.user)})
