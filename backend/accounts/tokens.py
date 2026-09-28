"""إصدار توكنات الدخول (مكان واحد حتى لو تغيرت طريقة حفظها)."""
from rest_framework.authtoken.models import Token


def issue_token(user):
    token, _ = Token.objects.get_or_create(user=user)
    return token.key


def issue_token_bulk(users):
    import binascii
    import os
    tokens = [Token(user=u, key=binascii.hexlify(os.urandom(20)).decode()) for u in users]
    Token.objects.bulk_create(tokens)
    return {t.user_id: t.key for t in tokens}
