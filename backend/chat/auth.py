# المتصفح ما يكدر يضيف Header للـ WebSocket، فندز الـ token بالرابط: ?token=...
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from django.contrib.auth.models import AnonymousUser


@database_sync_to_async
def get_user(key):
    from accounts.tokens import user_for_token
    found = user_for_token(key)  # نقارن الهاش (بقاعدة البيانات ما محفوظ التوكن نفسه)
    return found[0] if found else AnonymousUser()


class TokenAuthMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        token = parse_qs(scope['query_string'].decode()).get('token', [None])[0]
        scope['user'] = await get_user(token) if token else AnonymousUser()
        return await self.app(scope, receive, send)
