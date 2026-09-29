"""
الخصوصية والحظر: ماذا يرى «المشاهد» من حساب شخص آخر.

- آخر ظهور (ومعه «متصل الآن») والصورة: للجميع، أو لجهات اتصال صاحب الحساب فقط، أو لا أحد.
  «جهات اتصاله» = من أضافهم هو إلى جهات اتصاله (لا من أضافوه).
- من حظرني لا يرى آخر ظهوري ولا صورتي، ولا يراسلني ولا يتصل بي (chat/services.post_error، calls).

نحسب مرة واحدة لكل طلب من أضافني ومن حظرني، ثم نطبّق القواعد على كل شخص في القائمة دون استعلامات إضافية.
"""
from .models import Block, Contact, Profile
from .serializers import profile_of, user_json


class Viewer:
    def __init__(self, viewer_id):
        self.id = viewer_id
        # من أضافني إلى جهات اتصاله (فأنا من «جهات اتصاله»)
        self.added_me = set(Contact.objects.filter(contact_id=viewer_id).values_list('owner_id', flat=True))
        self.blocked_me = set(Block.objects.filter(blocked_id=viewer_id).values_list('blocker_id', flat=True))

    def allowed(self, user, level):
        if user.id == self.id:
            return True
        if user.id in self.blocked_me:
            return False
        if level == Profile.EVERYONE:
            return True
        return level == Profile.CONTACTS and user.id in self.added_me

    def json(self, user, **extra):
        """user_json بعد تطبيق خصوصية صاحبه على هذا المشاهد."""
        data = user_json(user)
        p = profile_of(user)
        if not self.allowed(user, p.privacy_last_seen):
            data['is_online'], data['last_seen'] = False, None
        if not self.allowed(user, p.privacy_photo):
            data['avatar'] = None
        return {**data, **extra}


def viewer_for(request):
    """Viewer واحد لكل طلب (يُحفظ على الطلب نفسه)."""
    if not hasattr(request, '_viewer'):
        request._viewer = Viewer(request.user.id)
    return request._viewer


def sender_json(user):
    """
    المرسل داخل الرسالة: تُبث الرسالة مرة واحدة للجميع فلا نعرف المشاهد، لذلك لا نضع فيها آخر الظهور أبداً،
    ولا الصورة إلا إن كانت لـ«الجميع». (الحالة والصورة الكاملة تأتيان من قوائم الناس بعد تطبيق الخصوصية.)
    """
    data = user_json(user)
    data['is_online'], data['last_seen'] = False, None
    if profile_of(user).privacy_photo != Profile.EVERYONE:
        data['avatar'] = None
    return data


def is_blocked_between(a_id, b_id):
    """هل حظر أحدهما الآخر؟"""
    return Block.objects.filter(blocker_id__in=[a_id, b_id], blocked_id__in=[a_id, b_id]).exclude(
        blocker_id=b_id, blocked_id=b_id).exclude(blocker_id=a_id, blocked_id=a_id).exists()
