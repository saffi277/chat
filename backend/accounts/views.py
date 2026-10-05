import re

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.core import signing
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from rest_framework import generics, serializers, status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from config.throttles import LoginThrottle, LookupThrottle

from .models import Block, Contact, Profile, Report, SupportRequest
from .privacy import viewer_for
from .serializers import MeSerializer, ProfileUpdateSerializer, RegisterSerializer, UserSerializer, profile_of, user_json
from .tokens import issue_token

User = get_user_model()


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def register(request):
    # request.data = الـ JSON اللي دزته الواجهة بالـ body
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)  # إذا غلط يرجع 400 تلقائياً
    user = serializer.save()
    token = issue_token(user, request.META.get('HTTP_USER_AGENT', ''))
    return Response({'token': token, 'user': MeSerializer(user).data}, status=status.HTTP_201_CREATED)


def find_user(identifier):
    """نلگى الحساب بأي وحدة: اسم المستخدم، أو البريد الجامعي، أو الرقم الجامعي."""
    identifier = (identifier or '').strip()
    if not identifier:
        return None
    return (User.objects.filter(username__iexact=identifier).first()
            or User.objects.filter(email__iexact=identifier).first()
            or User.objects.filter(profile__university_id__iexact=identifier).first())


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login(request):
    """{"identifier": اسم المستخدم أو البريد أو الرقم الجامعي, "password": ..., "role": student|faculty|staff (اختياري)}"""
    found = find_user(request.data.get('identifier') or request.data.get('username'))
    user = found and authenticate(username=found.username, password=request.data.get('password'))
    if not user:
        return Response({'detail': _('بيانات الدخول غير صحيحة. تحقّق من البريد أو الرقم الجامعي وكلمة المرور')},
                        status=status.HTTP_400_BAD_REQUEST)
    profile, _created = Profile.objects.get_or_create(user=user)
    role = request.data.get('role')
    # سجّل تدريسياً ولم تعتمده الإدارة بعد: يدخل (بصلاحيات طالب)، والواجهة تُظهر أن طلبه قيد المراجعة
    if role and role != profile.role and role == profile.requested_role:
        role = profile.role
    # مدير النظام يدخل من أي تبويب (حساب createsuperuser يبدأ «طالباً»، فكان يُرفض تحت «إداري»)
    if role and role != profile.role and not user.is_staff:
        # نتحقق بعد كلمة المرور، حتى ما نكشف دور أي حساب لأي أحد
        return Response({'detail': _('هذا الحساب مسجّل بدور «{role}»، اختر الدور الصحيح').format(role=_(profile.get_role_display())),
                         'role': profile.role}, status=status.HTTP_400_BAD_REQUEST)
    # التحقق بخطوتين: لا توكن بعد، بل «تذكرة» موقّعة صالحة 5 دقائق تُستبدل بكلمة التحقق
    if profile.two_step_hash:
        return Response({'two_step': True, 'ticket': signing.dumps(user.pk, salt=TWO_STEP_SALT), 'hint': profile.two_step_hint})
    # كل دخول (كل جهاز) إله توكن جديد، ونحفظ الهاش مالته بس
    token = issue_token(user, request.META.get('HTTP_USER_AGENT', ''))
    return Response({'token': token, 'user': MeSerializer(user).data})


TWO_STEP_SALT = 'wasl.two-step'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([LoginThrottle])
def login_two_step(request):
    """الخطوة الثانية: {"ticket": من login, "code": كلمة التحقق} ← التوكن. المحاولات محدودة مثل الدخول."""
    try:
        user_id = signing.loads(request.data.get('ticket') or '', salt=TWO_STEP_SALT, max_age=300)
    except signing.BadSignature:
        return Response({'detail': _('انتهت مهلة الدخول. سجّل الدخول من جديد')}, status=status.HTTP_400_BAD_REQUEST)
    user = User.objects.filter(pk=user_id, is_active=True).select_related('profile').first()
    if not user or not check_password(request.data.get('code') or '', profile_of(user).two_step_hash):
        return Response({'detail': _('كلمة التحقق بخطوتين غير صحيحة')}, status=status.HTTP_400_BAD_REQUEST)
    token = issue_token(user, request.META.get('HTTP_USER_AGENT', ''))
    return Response({'token': token, 'user': MeSerializer(user).data})


def require_password(request):
    if not request.user.check_password(request.data.get('password') or ''):
        raise ValidationError({'password': _('كلمة المرور غير صحيحة')})


@api_view(['POST', 'DELETE'])
@throttle_classes([LoginThrottle])
def two_step(request):
    """
    POST {password, code, hint?} ← تفعيل أو تغيير كلمة التحقق بخطوتين (تُحفظ هاشاً).
    DELETE {password} ← إيقافها. في الحالتين نطلب كلمة المرور الحالية.
    """
    require_password(request)
    profile = profile_of(request.user)
    if request.method == 'DELETE':
        profile.two_step_hash, profile.two_step_hint = '', ''
    else:
        code = request.data.get('code') or ''
        if len(code) < 4:
            raise ValidationError({'code': _('كلمة التحقق 4 أحرف على الأقل')})
        if code == request.data.get('password'):
            raise ValidationError({'code': _('اختر كلمة تحقق مختلفة عن كلمة المرور')})
        profile.two_step_hash = make_password(code)
        profile.two_step_hint = (request.data.get('hint') or '').strip()[:60]
    profile.save(update_fields=['two_step_hash', 'two_step_hint'])
    return Response(MeSerializer(request.user).data)


def device_name(agent):
    """وصف مختصر للجهاز من user-agent: «Chrome • Windows»."""
    agent = agent or ''
    os_name = next((n for k, n in [('iPhone', 'iPhone'), ('iPad', 'iPad'), ('Android', 'Android'), ('Windows', 'Windows'),
                                   ('Mac OS', 'Mac'), ('Linux', 'Linux')] if k in agent), '')
    browser = next((n for k, n in [('Edg/', 'Edge'), ('OPR/', 'Opera'), ('Firefox/', 'Firefox'), ('CriOS', 'Chrome'),
                                   ('Chrome/', 'Chrome'), ('Safari/', 'Safari')] if k in agent), '')
    return ' • '.join(x for x in (browser, os_name) if x)


@api_view(['GET'])
def sessions(request):
    """الأجهزة المتصلة بحسابي (جلسة لكل دخول)، وهذا الجهاز أولاً."""
    current = request.auth.pk if request.auth is not None else None
    rows = sorted(request.user.auth_tokens.all(), key=lambda t: (t.pk != current, -(t.last_used or t.created).timestamp()))
    return Response([{'id': t.pk, 'device': device_name(t.user_agent), 'user_agent': t.user_agent[:200],
                      'created': t.created.isoformat(), 'last_used': (t.last_used or t.created).isoformat(),
                      'current': t.pk == current} for t in rows])


@api_view(['DELETE'])
def session_detail(request, pk):
    """إنهاء جلسة جهاز: يخرج ذلك الجهاز فوراً (توكنه لم يعد صالحاً)."""
    deleted = request.user.auth_tokens.filter(pk=pk).delete()[0]
    return Response(status=status.HTTP_204_NO_CONTENT if deleted else status.HTTP_404_NOT_FOUND)


@api_view(['POST'])
@throttle_classes([LoginThrottle])
def delete_account(request):
    """
    حذف الحساب نهائياً: {"password": ...}. تُحذف رسائله وملفاته وحالاته وصورته وجلساته،
    ويغادر مجموعاته (ويُعيَّن مشرف جديد إن كان المشرف الوحيد).
    """
    require_password(request)
    from chat.models import Membership, Message
    from chat.views import leave_group
    user = request.user
    for m in Membership.objects.filter(user=user, conversation__kind__in=['group', 'channel']).select_related('conversation'):
        leave_group(user, m, actor=user)
    for msg in Message.objects.filter(sender=user).exclude(file='').exclude(file__isnull=True).only('file'):
        msg.file.delete(save=False)
    p = profile_of(user)
    if p.pk and p.avatar:
        p.avatar.delete(save=False)
    from chat.services import contact_ids, forget_contacts
    forget_contacts(user.id, *contact_ids(user.id))
    user.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
def logout(request):
    """تسجيل الخروج: نمسح توكن هذا الجهاز من السيرفر (مو بس من المتصفح). {"all": true} = من كل الأجهزة."""
    if request.data.get('all'):
        request.user.auth_tokens.all().delete()
    elif request.auth is not None:
        request.auth.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'PATCH'])
def me(request):
    # request.user انعرف من الـ Token اللي بالـ Header
    if request.method == 'PATCH':
        profile, _created = Profile.objects.get_or_create(user=request.user)
        old_avatar = profile.avatar.name if profile.avatar else None
        # partial=True: نعدل بس الحقول اللي انرسلت
        serializer = ProfileUpdateSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        # البريد الجامعي في جدول المستخدم لا الملف الشخصي: نتحقق منه قبل حفظ أي شيء
        email = request.data.get('email') if hasattr(request.data, 'get') else None
        if email is not None:
            email = serializers.EmailField(allow_blank=True).run_validation(str(email).strip())
            if email and User.objects.filter(email__iexact=email).exclude(pk=request.user.pk).exists():
                raise ValidationError({'email': _('هذا البريد مسجّل بحساب آخر')})
        serializer.save()
        if email is not None and email != request.user.email:
            request.user.email = email
            request.user.save(update_fields=['email'])
        # إذا تبدلت الصورة أو انمسحت، نمسح الملف القديم حتى ما يتكدس
        if old_avatar and old_avatar != (profile.avatar.name if profile.avatar else None):
            profile.avatar.storage.delete(old_avatar)
        request.user.refresh_from_db()
    return Response(MeSerializer(request.user).data)


def with_contact_flag(request, users, mine):
    """المستخدم (بعد تطبيق خصوصيته عليّ) + هل هو ضمن جهات اتصالي (لزر «إضافة إلى جهات الاتصال»)."""
    viewer = viewer_for(request)
    return [viewer.json(u, is_contact=u.id in mine) for u in users]


class UserListView(generics.ListAPIView):
    """
    GET /api/users/?q=بحث&limit=50&offset=0 — الناس الذين أعرفهم فقط:
    جهات اتصالي، ومن يشاركني محادثة أو مجموعة، ومن أضافني. لا أحد يرى قائمة كل حسابات الجامعة؛
    للوصول إلى شخص جديد تضيفه بمعرّف تعرفه عنه (/api/users/find/ ثم /api/contacts/).
    """

    serializer_class = UserSerializer

    def get_queryset(self):
        from chat.services import known_ids
        me = self.request.user
        self.mine = my_contact_ids(me.id)
        qs = (User.objects.filter(id__in=known_ids(me.id)).select_related('profile')
              .annotate(saved=Exists(Contact.objects.filter(owner=me, contact=OuterRef('pk'))))
              .order_by('-saved', 'profile__display_name', 'username'))
        q = self.request.query_params.get('q', '').strip()  # ?q= بالاسم أو الرقم أو الرقم الجامعي
        if q:
            qs = qs.filter(Q(username__icontains=q) | Q(profile__display_name__icontains=q)
                           | Q(profile__phone__icontains=q) | Q(profile__university_id__iexact=q))
        return qs

    def list(self, request, *args, **kwargs):
        try:
            limit = max(1, min(int(request.query_params.get('limit', 50)), 200))
            offset = max(0, int(request.query_params.get('offset', 0)))
        except ValueError:
            limit, offset = 50, 0
        page = self.get_queryset()[offset:offset + limit]
        return Response(with_contact_flag(request, page, self.mine))


def my_contact_ids(user_id):
    from chat.services import my_contact_ids as ids
    return ids(user_id)


def can_see(me, other_id):
    from chat.services import known_ids
    return other_id == me.id or other_id in known_ids(me.id)


@api_view(['GET'])
def user_detail(request, pk):
    """صفحة جهة الاتصال: لمن أعرفه فقط (لا يمكن تصفّح الحسابات بتجربة الأرقام)."""
    if not can_see(request.user, pk):
        return Response({'detail': _('لا يوجد حساب بهذا المعرّف')}, status=status.HTTP_404_NOT_FOUND)
    user = get_object_or_404(User.objects.select_related('profile'), pk=pk)
    return Response(with_contact_flag(request, [user], my_contact_ids(request.user.id))[0])


def lookup(identifier):
    """
    نجد الحساب بمعرّف يعرفه صاحبه عنه بالضبط (لا بحث جزئي): الرقم الجامعي، أو البريد، أو اسم المستخدم،
    أو رقم الهاتف. المطابقة التامة تمنع تصفّح الناس بكتابة حرف أو حرفين.
    """
    identifier = (identifier or '').strip().lstrip('@')
    if not identifier:
        return None
    found = find_user(identifier)
    if found:
        return found
    phone = re.sub(r'[\s\-()]', '', identifier)
    if re.fullmatch(r'\+?\d{7,15}', phone):
        # 07701234567 و +9647701234567 الرقم نفسه: نقارن آخر 10 أرقام بعد حذف الصفر المحلي
        tail = phone.lstrip('+').lstrip('0')[-10:]
        matches = list(User.objects.filter(profile__phone__endswith=tail)[:2])
        return matches[0] if len(matches) == 1 else None
    return None


@api_view(['GET'])
@throttle_classes([LookupThrottle])
def find(request):
    """GET /api/users/find/?q=<معرّف> ← الشخص (مع is_contact) أو 404. تمهيد لإضافته جهة اتصال."""
    user = lookup(request.query_params.get('q'))
    if not user or user == request.user:
        msg = _('هذا حسابك أنت') if user else _('لم نجد حساباً بهذا المعرّف. تأكد من الرقم الجامعي أو البريد أو اسم المستخدم')
        return Response({'detail': msg}, status=status.HTTP_404_NOT_FOUND)
    user = User.objects.select_related('profile').get(pk=user.pk)
    return Response(with_contact_flag(request, [user], my_contact_ids(request.user.id))[0])


@api_view(['GET', 'POST'])
@throttle_classes([LookupThrottle])
def contacts(request):
    """
    GET  ← جهات اتصالي (مرتبة بالاسم).
    POST {"identifier": "..."} أو {"user_id": 5} ← إضافة. user_id مقبول فقط لمن أعرفه أصلاً
    (عضو في مجموعتي، أو من راسلني)، وإلا فالمعرّف مطلوب.
    """
    from chat.services import forget_contacts
    me = request.user
    if request.method == 'GET':
        users = (User.objects.filter(contact_of__owner=me).select_related('profile')
                 .order_by('profile__display_name', 'username'))
        viewer = viewer_for(request)
        return Response([viewer.json(u, is_contact=True) for u in users])
    if request.data.get('identifier'):
        other = lookup(request.data['identifier'])
    else:
        try:
            other_id = int(request.data.get('user_id'))
        except (TypeError, ValueError):
            raise ValidationError({'identifier': _('اكتب الرقم الجامعي أو البريد أو اسم المستخدم')})
        other = User.objects.filter(pk=other_id).first() if can_see(me, other_id) else None
    if not other:
        return Response({'detail': _('لم نجد حساباً بهذا المعرّف. تأكد من الرقم الجامعي أو البريد أو اسم المستخدم')},
                        status=status.HTTP_404_NOT_FOUND)
    if other == me:
        raise ValidationError({'detail': _('هذا حسابك أنت')})
    _obj, created = Contact.objects.get_or_create(owner=me, contact=other)
    forget_contacts(me.id, other.id)
    other = User.objects.select_related('profile').get(pk=other.pk)
    return Response(viewer_for(request).json(other, is_contact=True),
                    status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['DELETE'])
def contact_detail(request, user_id):
    """إزالة من جهات اتصالي (المحادثات معه تبقى كما هي)."""
    from chat.services import forget_contacts
    Contact.objects.filter(owner=request.user, contact_id=user_id).delete()
    forget_contacts(request.user.id, user_id)
    return Response(status=status.HTTP_204_NO_CONTENT)


class HelpThrottle(AnonRateThrottle):
    scope = 'help'  # عدّاد خاص (لا يشارك عدّاد الطلبات العامة)
    rate = '10/hour'


@api_view(['POST'])
@permission_classes([AllowAny])
@throttle_classes([HelpThrottle])
def help_request(request):
    """من صفحة الدخول: {"kind": "password"|"support", "identifier", "contact", "message"}.
    الطلب يوصل للإداري بلوحة الإدارة (/admin)، وهو يعيّن رمز جديد أو يتواصل ويا صاحبه."""
    kind = request.data.get('kind')
    if kind not in (SupportRequest.PASSWORD, SupportRequest.SUPPORT):
        return Response({'kind': 'password | support'}, status=status.HTTP_400_BAD_REQUEST)
    identifier = (request.data.get('identifier') or '').strip()[:150]
    contact = (request.data.get('contact') or '').strip()[:150]
    message = (request.data.get('message') or '').strip()[:2000]
    if kind == SupportRequest.PASSWORD and not identifier:
        return Response({'identifier': _('اكتب بريدك أو رقمك الجامعي')}, status=status.HTTP_400_BAD_REQUEST)
    if kind == SupportRequest.SUPPORT and not message:
        return Response({'message': _('اكتب المشكلة')}, status=status.HTTP_400_BAD_REQUEST)
    SupportRequest.objects.create(kind=kind, identifier=identifier, contact=contact, message=message,
                                  user=find_user(identifier))
    # نفس الجواب سواء لگينا الحساب أو لا، حتى ما نكشف منو مسجل
    return Response({'detail': _('وصل طلبك إلى الدعم الفني، وسيتواصلون معك قريباً')}, status=status.HTTP_201_CREATED)


# ------------------------------------------------------------------ الحظر والإبلاغ

@api_view(['GET', 'POST'])
def blocks(request):
    """GET ← من حظرتُهم. POST {"user_id": 5} ← حظر (لمن أعرفه فقط)."""
    from chat.services import forget_contacts
    if request.method == 'GET':
        users = User.objects.filter(blocked_by__blocker=request.user).select_related('profile').order_by('-blocked_by__created_at')
        return Response([user_json(u) for u in users])
    try:
        other_id = int(request.data.get('user_id'))
    except (TypeError, ValueError):
        raise ValidationError({'user_id': _('الشخص مطلوب')})
    if other_id == request.user.id or not can_see(request.user, other_id):
        return Response({'detail': _('لا يوجد حساب بهذا المعرّف')}, status=status.HTTP_404_NOT_FOUND)
    Block.objects.get_or_create(blocker=request.user, blocked_id=other_id)
    forget_contacts(request.user.id, other_id)
    # يختفي «متصل الآن» عنده فوراً
    from chat.services import send_to_users
    send_to_users([other_id], {'type': 'presence', 'user_id': request.user.id, 'is_online': False})
    return Response({'blocked': True}, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
def block_detail(request, user_id):
    from chat.services import forget_contacts
    Block.objects.filter(blocker=request.user, blocked_id=user_id).delete()
    forget_contacts(request.user.id, user_id)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['POST'])
@throttle_classes([HelpThrottle])
def report(request):
    """
    بلاغ للإدارة: {"user_id"?, "message_id"?, "reason": spam|abuse|harassment|other, "details"?, "block"?: true}.
    الرسالة يجب أن تكون في محادثة أنا عضو فيها. مع "block": يُحظر صاحبها أيضاً.
    """
    from chat.models import Message
    data = request.data
    reason = data.get('reason') or Report.OTHER
    if reason not in dict(Report.REASONS):
        raise ValidationError({'reason': _('سبب غير معروف')})
    msg, target = None, None
    if data.get('message_id'):
        msg = Message.objects.filter(pk=data['message_id'], conversation__memberships__user=request.user).select_related('sender').first()
        if not msg:
            return Response({'detail': _('الرسالة غير موجودة')}, status=status.HTTP_404_NOT_FOUND)
        target = msg.sender
    elif data.get('user_id'):
        try:
            uid = int(data['user_id'])
        except (TypeError, ValueError):
            uid = 0
        target = User.objects.filter(pk=uid).first() if can_see(request.user, uid) else None
    if not target or target == request.user:
        return Response({'detail': _('لا يوجد حساب بهذا المعرّف')}, status=status.HTTP_404_NOT_FOUND)
    Report.objects.create(reporter=request.user, user=target, message=msg, conversation=msg.conversation if msg else None,
                          message_text=(msg.content if msg else '')[:2000], reason=reason,
                          details=(data.get('details') or '')[:2000])
    if data.get('block') in (True, 'true', '1', 1):
        from chat.services import forget_contacts
        Block.objects.get_or_create(blocker=request.user, blocked=target)
        forget_contacts(request.user.id, target.id)
    return Response({'ok': True}, status=status.HTTP_201_CREATED)
