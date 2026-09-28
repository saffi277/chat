from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, DateTimeField, Exists, IntegerField, Min, OuterRef, Prefetch, Q, Subquery, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.serializers import profile_of
from config.throttles import SendThrottle, UserThrottle

from . import services
from .media import guess_kind, validate_upload
from .models import Conversation, Membership, Message, Reaction, StarredMessage
from .serializers import ConversationSerializer, MemberSerializer, MessageSerializer

User = get_user_model()
PAGE = 50
EPOCH = timezone.make_aware(timezone.datetime(2000, 1, 1))


def name_of(user):
    return profile_of(user).display_name or user.username


def my_membership(request, pk):
    # نتأكد أن المستخدم عضو بالمحادثة، وإلا 404 (ما نكشف وجودها)
    return get_object_or_404(Membership.objects.select_related('conversation'), conversation_id=pk, user=request.user)


def require_admin(membership):
    if membership.conversation.kind != Conversation.GROUP or membership.role != Membership.ADMIN:
        raise PermissionDenied(_('هذا الإجراء للمشرف فقط'))


def conv_data(request, conv):
    return ConversationSerializer(conv, context={'request': request}).data


# ------------------------------------------------------------------ المحادثات

@api_view(['GET', 'POST'])
def conversations(request):
    if request.method == 'GET':
        # ?filter=all|groups|favorites|unread|archived  و  ?q=نص للبحث
        f = request.query_params.get('filter', 'all')
        mine = Membership.objects.filter(user=request.user)
        qs = Conversation.objects.filter(memberships__in=mine.filter(is_archived=(f == 'archived')))
        if f == 'groups':
            qs = qs.filter(kind=Conversation.GROUP)
        elif f == 'favorites':
            qs = qs.filter(memberships__in=mine.filter(is_favorite=True))
        q = request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(
                Q(title__icontains=q) | Q(memberships__user__username__icontains=q)
                | Q(memberships__user__profile__display_name__icontains=q)).distinct()
        my_row = Membership.objects.filter(conversation=OuterRef('pk'), user=request.user)
        # كلشي يتحسب بنفس الاستعلام (بدل استعلامين لكل محادثة): آخر رسالة، غير المقروء، التثبيت.
        # 2000 طالب يفتحون التطبيق سوه = 2000 طلب، وكل طلب هسه بعدد ثابت من الاستعلامات مهما كثرت محادثاته
        since = Coalesce(OuterRef('cleared'), Value(EPOCH, output_field=DateTimeField()))
        visible = Message.objects.filter(conversation=OuterRef('pk'), created_at__gt=since)
        unread = (visible.filter(id__gt=OuterRef('my_read')).exclude(sender_id=request.user.id)
                  .order_by().values('conversation').annotate(c=Count('id')).values('c'))
        # المجموعات ما نحمل أعضاءها (ممكن مئات): نجيب العدد، وأقل نقطة قراءة/وصول عند الباقين (لعلامات ✓✓)
        others = Membership.objects.filter(conversation=OuterRef('pk')).exclude(user=request.user).order_by().values(
            'conversation')
        qs = qs.annotate(
            pinned=Exists(my_row.filter(is_pinned=True)),
            cleared=Subquery(my_row.values('cleared_at')[:1]),
            my_read=Subquery(my_row.values('last_read_id')[:1]),
            my_role=Subquery(my_row.values('role')[:1]),
            my_favorite=Subquery(my_row.values('is_favorite')[:1]),
            my_muted=Subquery(my_row.values('is_muted')[:1]),
            my_archived=Subquery(my_row.values('is_archived')[:1]),
            n_members=Coalesce(Subquery(others.annotate(c=Count('id')).values('c'), output_field=IntegerField()), 0) + 1,
            others_read=Subquery(others.annotate(m=Min('last_read_id')).values('m')),
            others_delivered=Subquery(others.annotate(m=Min('last_delivered_id')).values('m')),
        ).annotate(
            last_msg_id=Subquery(visible.order_by('-id').values('id')[:1]),
            last=Coalesce(Subquery(visible.order_by('-id').values('created_at')[:1]), 'created_at'),
            unread=Coalesce(Subquery(unread, output_field=IntegerField()), 0),
        )
        # "حذفت المحادثة" = تنخفي لحد ما توصل رسالة جديدة بعد الحذف
        qs = (qs.filter(Q(cleared__isnull=True) | Q(last_msg_id__isnull=False)).order_by('-pinned', '-last')
              .prefetch_related(Prefetch('memberships', queryset=Membership.objects.exclude(
                  conversation__kind=Conversation.GROUP).select_related('user__profile'))))
        convs = list(qs)
        ids = [c.last_msg_id for c in convs if c.last_msg_id]
        last_messages = {m.id: m for m in Message.objects.filter(id__in=ids).select_related(
            'sender__profile', 'reply_to__sender__profile').prefetch_related('reactions')} if ids else {}
        data = ConversationSerializer(convs, many=True, context={'request': request, 'last_messages': last_messages, 'compact': True}).data
        if f == 'unread':
            data = [c for c in data if c['unread_count']]
        return Response(data)

    # POST {"user_id": 5} → نرجع المحادثة الثنائية الموجودة أو ننشئ وحدة جديدة
    other = get_object_or_404(User, pk=request.data.get('user_id'))
    if other == request.user:
        return Response({'detail': _('لمراسلة نفسك استخدم الرسائل المحفوظة')}, status=status.HTTP_400_BAD_REQUEST)
    # filter مرتين = JOIN مرتين: محادثة ثنائية فيها أنا وفيها هو
    conv = (Conversation.objects.filter(kind=Conversation.DIRECT)
            .filter(memberships__user=request.user).filter(memberships__user=other).first())
    created = conv is None
    if created:
        conv = Conversation.objects.create(kind=Conversation.DIRECT, created_by=request.user)
        Membership.objects.bulk_create([Membership(conversation=conv, user=u) for u in (request.user, other)])
        services.forget_contacts(request.user.id, other.id)
    return Response(conv_data(request, conv), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


@api_view(['GET'])
def saved(request):
    """الرسائل المحفوظة: محادثة بيك وحدك، تحفظ بيها أي شي."""
    conv = Conversation.objects.filter(kind=Conversation.SAVED, memberships__user=request.user).first()
    if not conv:
        conv = Conversation.objects.create(kind=Conversation.SAVED, created_by=request.user)
        Membership.objects.create(conversation=conv, user=request.user, role=Membership.ADMIN)
    return Response(conv_data(request, conv))


@api_view(['POST'])
def create_group(request):
    """POST {title, member_ids: [..], description?} (+ avatar إذا multipart)"""
    title = (request.data.get('title') or '').strip()
    if not title:
        raise ValidationError({'title': _('اسم المجموعة مطلوب')})
    ids = request.data.getlist('member_ids') if hasattr(request.data, 'getlist') else request.data.get('member_ids', [])
    members = list(User.objects.filter(id__in=ids).exclude(id=request.user.id))
    conv = Conversation.objects.create(
        kind=Conversation.GROUP, title=title[:80], created_by=request.user,
        description=(request.data.get('description') or '')[:300], avatar=request.FILES.get('avatar'))
    Membership.objects.create(conversation=conv, user=request.user, role=Membership.ADMIN)
    Membership.objects.bulk_create([Membership(conversation=conv, user=u) for u in members])
    services.forget_contacts(request.user.id, *[u.id for u in members])
    services.system_message(conv, request.user, f'{name_of(request.user)} أنشأ المجموعة "{title}"')
    return Response(conv_data(request, conv), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
def conversation_detail(request, pk):
    m = my_membership(request, pk)
    conv = m.conversation
    if request.method == 'GET':
        return Response(conv_data(request, conv))

    if request.method == 'DELETE':
        # بالمجموعة = مغادرة. بالثنائية = أرشفة (ما نمسح رسائل الطرف الثاني)
        if conv.kind == Conversation.GROUP:
            leave_group(request.user, m, actor=request.user)
        else:
            Membership.objects.filter(pk=m.pk).update(is_archived=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    # PATCH: إعداداتي الخاصة (أي عضو)
    prefs = {k: bool(request.data[k]) for k in ('is_favorite', 'is_muted', 'is_archived', 'is_pinned')
             if k in request.data}
    if prefs:
        Membership.objects.filter(pk=m.pk).update(**prefs)
    # معلومات المجموعة (المشرف بس)
    group_fields = [k for k in ('title', 'description', 'avatar') if k in request.data]
    if group_fields:
        require_admin(m)
        if 'title' in request.data:
            title = (request.data.get('title') or '').strip()
            if not title:
                raise ValidationError({'title': _('اسم المجموعة مطلوب')})
            if title != conv.title:
                services.system_message(conv, request.user, f'{name_of(request.user)} غيّر اسم المجموعة إلى "{title}"')
            conv.title = title[:80]
        if 'description' in request.data:
            conv.description = (request.data.get('description') or '')[:300]
        if 'avatar' in request.data:
            if conv.avatar:
                conv.avatar.delete(save=False)
            conv.avatar = request.FILES.get('avatar')
            if conv.avatar:
                validate_upload(Message.IMAGE, conv.avatar)
        conv.save()
        services.send_to_users(services.member_ids(conv), {'type': 'conversation_updated', 'conversation_id': conv.id})
    conv = Conversation.objects.get(pk=conv.pk)
    return Response(conv_data(request, conv))


@api_view(['POST'])
def clear_conversation(request, pk):
    """حذف المحادثة عندي بس: رسائلها تختفي من عندي، والطرف الثاني ما يتأثر."""
    m = my_membership(request, pk)
    last_id = m.conversation.messages.order_by('-id').values_list('id', flat=True).first() or 0
    Membership.objects.filter(pk=m.pk).update(
        cleared_at=timezone.now(), is_pinned=False, last_read_id=max(m.last_read_id, last_id))
    return Response(status=status.HTTP_204_NO_CONTENT)


# ------------------------------------------------------------------ أعضاء المجموعة

def leave_group(user, membership, actor):
    conv = membership.conversation
    was_admin = membership.role == Membership.ADMIN
    services.forget_contacts(*services.member_ids(conv))
    membership.delete()
    text = f'{name_of(user)} غادر المجموعة' if actor == user else f'{name_of(actor)} أزال {name_of(user)}'
    remaining = conv.memberships.order_by('joined_at', 'id')
    if not remaining.exists():
        conv.delete()  # آخر واحد طلع: المجموعة ما إلها داعي
        return
    services.system_message(conv, actor, text)
    # إذا طلع آخر مشرف، أقدم عضو يصير مشرف
    if was_admin and not remaining.filter(role=Membership.ADMIN).exists():
        remaining.filter(pk=remaining.first().pk).update(role=Membership.ADMIN)
    services.send_to_users([user.id, *services.member_ids(conv)], {'type': 'conversation_updated', 'conversation_id': conv.id})


@api_view(['GET', 'POST'])
def members(request, pk):
    m = my_membership(request, pk)
    conv = m.conversation
    if request.method == 'GET':
        qs = conv.memberships.select_related('user__profile').order_by('-role', 'joined_at')
        return Response(MemberSerializer(qs, many=True).data)
    require_admin(m)
    ids = request.data.get('user_ids') or []
    existing = set(services.member_ids(conv))
    new = list(User.objects.filter(id__in=ids).exclude(id__in=existing))
    Membership.objects.bulk_create([Membership(conversation=conv, user=u) for u in new])
    services.forget_contacts(*services.member_ids(conv))
    for u in new:
        services.system_message(conv, request.user, f'{name_of(request.user)} أضاف {name_of(u)}')
    services.send_to_users(services.member_ids(conv), {'type': 'conversation_updated', 'conversation_id': conv.id})
    return Response(MemberSerializer(conv.memberships.select_related('user__profile'), many=True).data,
                    status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def member_detail(request, pk, user_id):
    m = my_membership(request, pk)
    target = get_object_or_404(Membership.objects.select_related('user__profile', 'conversation'),
                               conversation_id=pk, user_id=user_id)
    if request.method == 'DELETE':
        if target.user_id != request.user.id:
            require_admin(m)  # تطلع بنفسك، أو المشرف يطلعك
        if m.conversation.kind != Conversation.GROUP:
            raise ValidationError(_('هذه ليست مجموعة'))
        leave_group(target.user, target, actor=request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
    require_admin(m)
    role = request.data.get('role')
    if role not in (Membership.ADMIN, Membership.MEMBER):
        raise ValidationError({'role': 'admin | member'})
    target.role = role
    target.save(update_fields=['role'])
    return Response(MemberSerializer(target).data)


# ------------------------------------------------------------------ الرسائل

@api_view(['GET', 'POST'])
@throttle_classes([SendThrottle, UserThrottle])
def messages(request, pk):
    m = my_membership(request, pk)
    conv = m.conversation
    if request.method == 'GET':
        # آخر 50 رسالة. للأقدم: ?before=<id الرسالة الأقدم عندك>
        qs = conv.messages.select_related('sender__profile', 'reply_to__sender__profile').prefetch_related('reactions')
        if m.cleared_at:
            qs = qs.filter(created_at__gt=m.cleared_at)
        before = request.query_params.get('before')
        if before:
            qs = qs.filter(id__lt=before)
        try:
            limit = max(1, min(int(request.query_params.get('limit', PAGE)), 200))
        except ValueError:
            limit = PAGE
        page = list(qs.order_by('-id')[:limit])[::-1]
        receipts = services.receipts_for(conv)
        return Response(MessageSerializer(page, many=True, context={'receipts': receipts}).data)
    return Response(send_message(request, conv), status=status.HTTP_201_CREATED)


def send_message(request, conv):
    """
    نص:      {"content": "هلو"}
    ملف:     multipart: file=<الملف>, kind=image|video|voice|file (اختياري)، content=تعليق، duration=ثواني
    موقع:    {"kind": "location", "latitude": .., "longitude": .., "live_minutes": 15|60|480 (اختياري)}
    رد:      أضف "reply_to": <id>
    """
    data = request.data
    content = (data.get('content') or '').strip()
    upload = request.FILES.get('file')
    kind = data.get('kind') or (guess_kind(upload) if upload else Message.TEXT)
    fields = {'kind': kind}

    reply_id = data.get('reply_to')
    if reply_id:
        fields['reply_to'] = get_object_or_404(Message, pk=reply_id, conversation=conv)

    if kind == Message.TEXT:
        if not content:
            raise ValidationError({'content': _('الرسالة فارغة')})
    elif kind == Message.LOCATION:
        try:
            lat, lng = float(data.get('latitude')), float(data.get('longitude'))
        except (TypeError, ValueError):
            raise ValidationError({'latitude': _('الإحداثيات مطلوبة')})
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValidationError({'latitude': _('إحداثيات غير صحيحة')})
        fields.update(latitude=lat, longitude=lng)
        minutes = data.get('live_minutes')
        if minutes:
            minutes = int(minutes)
            if not 1 <= minutes <= 8 * 60:
                raise ValidationError({'live_minutes': _('من دقيقة واحدة حتى 8 ساعات')})
            fields['live_until'] = timezone.now() + timedelta(minutes=minutes)
    elif kind in (Message.IMAGE, Message.VIDEO, Message.VOICE, Message.FILE):
        if not upload:
            raise ValidationError({'file': _('الملف مطلوب')})
        validate_upload(kind, upload)
        fields.update(file=upload, file_name=upload.name[:255], file_size=upload.size)
        if data.get('duration'):
            fields['duration'] = float(data['duration'])
    else:
        raise ValidationError({'kind': _('نوع رسالة غير معروف')})
    return services.create_message(conv, request.user, content, **fields)


def my_message(request, message_id):
    msg = get_object_or_404(Message.objects.select_related('conversation'), pk=message_id,
                            conversation__memberships__user=request.user)
    if msg.sender_id != request.user.id:
        raise PermissionDenied(_('هذه ليست رسالتك'))
    if msg.deleted_at:
        raise ValidationError(_('الرسالة محذوفة'))
    return msg


@api_view(['PATCH', 'DELETE'])
def message_detail(request, message_id):
    """PATCH {"content": "..."} تعديل (النص بس) — DELETE حذف للكل."""
    msg = my_message(request, message_id)
    if request.method == 'DELETE':
        services.soft_delete(msg)
        return Response(status=status.HTTP_204_NO_CONTENT)
    content = (request.data.get('content') or '').strip()
    if msg.kind not in (Message.TEXT, Message.IMAGE, Message.VIDEO, Message.FILE):
        raise ValidationError(_('لا يمكن تعديل هذا النوع'))
    if msg.kind == Message.TEXT and not content:
        raise ValidationError({'content': _('الرسالة فارغة')})
    msg.content = content
    msg.edited_at = timezone.now()
    msg.save(update_fields=['content', 'edited_at'])
    return Response(services.message_changed(msg))


@api_view(['PATCH'])
def live_location(request, message_id):
    """الموقع المباشر: {"latitude", "longitude"} تحديث، أو {"stop": true} إيقاف."""
    msg = my_message(request, message_id)
    if msg.kind != Message.LOCATION or not msg.is_live:
        raise ValidationError(_('هذا ليس موقعاً مباشراً قيد المشاركة'))
    if request.data.get('stop'):
        msg.live_until = timezone.now()
    else:
        try:
            msg.latitude, msg.longitude = float(request.data['latitude']), float(request.data['longitude'])
        except (KeyError, TypeError, ValueError):
            raise ValidationError({'latitude': _('الإحداثيات مطلوبة')})
    msg.save(update_fields=['latitude', 'longitude', 'live_until'])
    return Response(services.message_changed(msg))


@api_view(['PATCH'])
def mark_read(request, pk):
    """PATCH: فتحت المحادثة، فكل اللي بيها صار مقروء."""
    m = my_membership(request, pk)
    return Response({'updated': services.mark_read(m.conversation, request.user)})


MEDIA_TYPES = {
    'image': Q(kind=Message.IMAGE),
    'video': Q(kind=Message.VIDEO),
    'media': Q(kind__in=[Message.IMAGE, Message.VIDEO]),
    'voice': Q(kind=Message.VOICE),
    'file': Q(kind=Message.FILE),
    'link': Q(has_link=True),  # النص مشفر، فنستخدم العلامة اللي تنحسب وقت الحفظ
    'location': Q(kind=Message.LOCATION),
}


@api_view(['GET'])
def shared_media(request, pk):
    """الوسائط المشتركة: ?type=media|image|video|voice|file|link|location و ?before=<id>"""
    m = my_membership(request, pk)
    base = m.conversation.messages.filter(deleted_at__isnull=True)
    if m.cleared_at:
        base = base.filter(created_at__gt=m.cleared_at)
    counts = base.aggregate(**{k: Count('id', filter=q) for k, q in MEDIA_TYPES.items()})
    kind = request.query_params.get('type', 'media')
    if kind not in MEDIA_TYPES:
        raise ValidationError({'type': _('نوع غير معروف')})
    qs = base.filter(MEDIA_TYPES[kind]).select_related('sender__profile').order_by('-id')
    if request.query_params.get('before'):
        qs = qs.filter(id__lt=request.query_params['before'])
    return Response({'counts': counts, 'results': MessageSerializer(qs[:60], many=True).data})


# ------------------------------------------------------------------ التفاعلات والرسائل المميزة

def visible_message(request, message_id):
    """أي رسالة بمحادثة أني عضو بيها (مو لازم رسالتي)."""
    return get_object_or_404(Message.objects.select_related('conversation'), pk=message_id,
                             conversation__memberships__user=request.user)


@api_view(['POST'])
def react(request, message_id):
    """POST {"emoji": "❤️"}: نفس الإيموجي مرة ثانية = يشيله، إيموجي ثاني = يبدله، وفارغ = يشيل."""
    msg = visible_message(request, message_id)
    if msg.deleted_at or msg.kind in (Message.SYSTEM, Message.CALL):
        raise ValidationError(_('لا يمكنك التفاعل مع هذه الرسالة'))
    emoji = (request.data.get('emoji') or '').strip()
    if len(emoji) > 16:
        raise ValidationError({'emoji': _('إيموجي واحد فقط')})
    current = Reaction.objects.filter(message=msg, user=request.user).first()
    if current and (not emoji or current.emoji == emoji):
        current.delete()
    elif emoji:
        Reaction.objects.update_or_create(message=msg, user=request.user, defaults={'emoji': emoji})
    return Response(services.message_changed(msg))


@api_view(['POST', 'DELETE'])
def star(request, message_id):
    """POST = ميّز الرسالة ⭐، DELETE = شيل التمييز."""
    msg = visible_message(request, message_id)
    if request.method == 'DELETE':
        StarredMessage.objects.filter(message=msg, user=request.user).delete()
        return Response({'starred': False})
    StarredMessage.objects.get_or_create(message=msg, user=request.user)
    return Response({'starred': True})


@api_view(['GET'])
def starred(request):
    """الرسائل المميزة عندي (?conversation=<id> لمحادثة وحدة)، الأحدث أول."""
    qs = (Message.objects.filter(stars__user=request.user, deleted_at__isnull=True,
                                 conversation__memberships__user=request.user)
          .select_related('sender__profile', 'reply_to__sender__profile').prefetch_related('reactions')
          .order_by('-stars__created_at'))
    conv = request.query_params.get('conversation')
    if conv:
        qs = qs.filter(conversation_id=conv)
    return Response(MessageSerializer(qs[:200], many=True).data)
