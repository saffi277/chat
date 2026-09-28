"""
توكنات الدخول بالهاش.
- نطلع للمستخدم توكن عشوائي (40 حرف hex) مرة وحدة وقت الدخول.
- بقاعدة البيانات نحفظ SHA-256 مالته بس. وكل طلب نحسب الهاش للتوكن اللي وصل وندور عليه.
ليش SHA-256 مو Argon2 مثل كلمات المرور؟ لأن التوكن عشوائي وطويل (160 بت) فما ينخمن،
وندقق عليه ويا كل طلب، فلازم يكون سريع.
"""
import hashlib
import secrets

from django.utils import timezone

from .models import AuthToken


def hash_token(key):
    return hashlib.sha256(key.encode()).hexdigest()


def issue_token(user, user_agent=''):
    key = secrets.token_hex(20)
    AuthToken.objects.create(user=user, key_hash=hash_token(key), user_agent=user_agent[:200])
    return key


def issue_token_bulk(users):
    keys = {u.id: secrets.token_hex(20) for u in users}
    AuthToken.objects.bulk_create([AuthToken(user=u, key_hash=hash_token(keys[u.id])) for u in users])
    return keys


def user_for_token(key):
    """يرجع (المستخدم، التوكن) أو None. نحدّث "آخر استخدام" مرة بالساعة بس (حتى ما نكتب ويا كل طلب)."""
    if not key:
        return None
    token = AuthToken.objects.select_related('user').filter(key_hash=hash_token(key)).first()
    if not token or not token.user.is_active:
        return None
    now = timezone.now()
    if not token.last_used or (now - token.last_used).total_seconds() > 3600:
        AuthToken.objects.filter(pk=token.pk).update(last_used=now)
    return token.user, token


def revoke_token(key):
    return AuthToken.objects.filter(key_hash=hash_token(key)).delete()[0]
