import re

from django.contrib.auth import authenticate, get_user_model
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

from .models import Contact, Profile, SupportRequest
from .serializers import MeSerializer, ProfileUpdateSerializer, RegisterSerializer, UserSerializer, user_json
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
    if role and role != profile.role:
        # نتحقق بعد كلمة المرور، حتى ما نكشف دور أي حساب لأي أحد
        return Response({'detail': _('هذا الحساب مسجّل بدور «{role}»، اختر الدور الصحيح').format(role=_(profile.get_role_display())),
                         'role': profile.role}, status=status.HTTP_400_BAD_REQUEST)
    # كل دخول (كل جهاز) إله توكن جديد، ونحفظ الهاش مالته بس
    token = issue_token(user, request.META.get('HTTP_USER_AGENT', ''))
    return Response({'token': token, 'user': MeSerializer(user).data})


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


def with_contact_flag(users, mine):
    """user_json + هل هو ضمن جهات اتصالي (لزر «إضافة إلى جهات الاتصال»)."""
    return [{**user_json(u), 'is_contact': u.id in mine} for u in users]


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
        return Response(with_contact_flag(page, self.mine))


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
    return Response(with_contact_flag([user], my_contact_ids(request.user.id))[0])


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
    return Response(with_contact_flag([user], my_contact_ids(request.user.id))[0])


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
        return Response([{**user_json(u), 'is_contact': True} for u in users])
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
    return Response({**user_json(other), 'is_contact': True},
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
