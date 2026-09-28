from rest_framework import exceptions
from rest_framework.authentication import BaseAuthentication, get_authorization_header

from .tokens import user_for_token


class HashedTokenAuthentication(BaseAuthentication):
    """نفس الـ Header القديم (Authorization: Token <التوكن>)، بس بقاعدة البيانات محفوظ الهاش مالته."""

    keyword = 'Token'

    def authenticate(self, request):
        auth = get_authorization_header(request).split()
        if not auth or auth[0].lower() != self.keyword.lower().encode():
            return None
        if len(auth) != 2:
            raise exceptions.AuthenticationFailed('توكن غير صالح')
        found = user_for_token(auth[1].decode(errors='ignore'))
        if not found:
            raise exceptions.AuthenticationFailed('انتهت الجلسة، سجل دخول من جديد')
        return found

    def authenticate_header(self, request):
        return self.keyword
