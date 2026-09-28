from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class _Switchable:
    """نطفيها بالاختبارات (تسوي مئات الطلبات بثواني)."""

    def allow_request(self, request, view):
        return not settings.THROTTLING_ENABLED or super().allow_request(request, view)


class LoginThrottle(_Switchable, AnonRateThrottle):
    """محاولات الدخول/التسجيل لكل IP (ضد تخمين كلمات المرور)."""
    scope = 'login'


class SendThrottle(_Switchable, UserRateThrottle):
    """إرسال الرسائل لكل مستخدم. القراءة (GET) ما تنحسب."""
    scope = 'send'

    def allow_request(self, request, view):
        return request.method != 'POST' or super().allow_request(request, view)


class UserThrottle(_Switchable, UserRateThrottle):
    pass


class AnonThrottle(_Switchable, AnonRateThrottle):
    pass


class LookupThrottle(_Switchable, UserRateThrottle):
    """
    البحث عن حساب بمعرّفه وإضافة جهة اتصال: 30 في الدقيقة لكل مستخدم، حتى لا يجرّب أحدٌ آلاف المعرّفات.
    scope خاص به: لو شارك عدّاد الطلبات العامة لحُسبت عليه كل طلبات التطبيق.
    عرض قائمة جهات الاتصال (GET /api/contacts/) لا يُحسب.
    """
    scope = 'lookup'
    rate = '30/min'

    def allow_request(self, request, view):
        if request.method == 'GET' and request.path.rstrip('/').endswith('/contacts'):
            return True
        return super().allow_request(request, view)
