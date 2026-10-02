import json
import logging
import os
import urllib.request
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone, translation
from django.utils.translation import gettext as _
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from accounts.privacy import viewer_for
from accounts.serializers import UserSerializer, profile_of
from chat.models import Conversation, Membership, Message
from chat.services import create_message, is_blocked, known_ids, member_ids, send_to_users
from notifications.push import in_language, send_to_user

from .models import Call, CallInvite

RING_TIMEOUT = timedelta(seconds=60)
# المكالمة الجماعية: كل مشارك يتصل بكل مشارك مباشرة (Mesh)، فنضع حداً معقولاً لعدد المشاركين
MAX_PARTICIPANTS = 8
log = logging.getLogger('notifications')


class CallSerializer(serializers.ModelSerializer):
    caller = UserSerializer(read_only=True)
    duration = serializers.IntegerField(read_only=True)
    direction = serializers.SerializerMethodField()
    peer = serializers.SerializerMethodField()
    conversation_kind = serializers.CharField(source='conversation.kind', read_only=True)
    title = serializers.CharField(source='conversation.title', read_only=True)
    participants = serializers.SerializerMethodField()
    multi = serializers.SerializerMethodField()
    invited_by = serializers.SerializerMethodField()

    class Meta:
        model = Call
        fields = ['id', 'conversation', 'conversation_kind', 'title', 'caller', 'peer', 'kind', 'status',
                  'direction', 'created_at', 'answered_at', 'ended_at', 'duration', 'participants', 'multi', 'invited_by']

    def get_multi(self, obj):
        """مكالمة بين أكثر من شخصين (مجموعة، أو ثنائية أُضيف إليها أحد): يتصل كل مشارك بالجميع."""
        return is_multi(obj)

    def get_invited_by(self, obj):
        """دُعيتُ إلى هذه المكالمة (لستُ عضواً في محادثتها): من دعاني."""
        me = self.context['request'].user
        invite = next((i for i in obj.invites.all() if i.user_id == me.id), None) if obj.pk else None
        return UserSerializer(invite.invited_by).data if invite else None

    def get_participants(self, obj):
        """من في المكالمة الآن (المكالمة الجماعية: يتصل المنضم الجديد بكل واحد منهم)."""
        if obj.status not in (Call.RINGING, Call.ONGOING):
            return []
        return list(obj.joined.values_list('id', flat=True))

    def get_direction(self, obj):
        """من وجهة نظري: outgoing (أنا اتصلت)، incoming (رديت)، missed (فاتتني)."""
        me = self.context['request'].user
        if obj.caller_id == me.id:
            return 'outgoing'
        return 'incoming' if obj.answered_at and obj.joined.filter(id=me.id).exists() else 'missed'

    def get_peer(self, obj):
        """الطرف الثاني بالمكالمة الثنائية (للمجموعة: None والواجهة تعرض اسم المجموعة)."""
        if obj.conversation.kind != Conversation.DIRECT:
            return None
        me = self.context['request'].user
        if not obj.conversation.memberships.filter(user=me).exists():
            return None  # دُعيت إلى مكالمة بين شخصين آخرين: لا «طرف ثانٍ» واحد
        other = next((m.user for m in obj.conversation.memberships.select_related('user__profile')
                      if m.user_id != me.id), None)
        return viewer_for(self.context['request']).json(other) if other else None


def ice_servers():
    """
    STUN: يساعد الجهاز على معرفة عنوانه على الإنترنت (يكفي على الشبكة نفسها وكثير من الشبكات المنزلية).
    TURN: خادم ترحيل يمرّر الصوت والصورة عندما لا يصل الجهازان إلى بعضهما مباشرة
    (مثلاً: هاتف على بيانات الجوال وحاسوب على واي فاي). يُفعَّل بإحدى الطرق التالية في متغيرات البيئة:
      1) CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN  (بيانات دخول مؤقتة من Cloudflare)
      2) TURN_CREDENTIALS_URL  (رابط يعيد قائمة iceServers بصيغة JSON، مثل خدمة Metered)
      3) TURN_URLS (مفصولة بفواصل) + TURN_USERNAME + TURN_CREDENTIAL  (خادم TURN خاص، مثل coturn)
    """
    servers = list(getattr(settings, 'ICE_SERVERS', [{'urls': ['stun:stun.l.google.com:19302']}]))
    return servers + turn_servers()


def turn_servers():
    cached = cache.get('turn_servers')
    if cached is not None:
        return cached
    result, ttl = [], 3600
    try:
        key_id, token = os.environ.get('CLOUDFLARE_TURN_KEY_ID'), os.environ.get('CLOUDFLARE_TURN_API_TOKEN')
        creds_url = os.environ.get('TURN_CREDENTIALS_URL')
        if key_id and token:
            req = urllib.request.Request(
                f'https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers',
                data=json.dumps({'ttl': 86400}).encode(), method='POST',
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.load(r).get('iceServers')
            result = data if isinstance(data, list) else [data] if data else []
            ttl = 12 * 3600  # بيانات الدخول صالحة 24 ساعة، فنجددها قبل انتهائها بوقت كافٍ
        elif creds_url:
            with urllib.request.urlopen(creds_url, timeout=5) as r:
                data = json.load(r)
            result = data if isinstance(data, list) else data.get('iceServers', [])
        elif os.environ.get('TURN_URLS'):
            result = [{'urls': [u.strip() for u in os.environ['TURN_URLS'].split(',') if u.strip()],
                       'username': os.environ.get('TURN_USERNAME', ''),
                       'credential': os.environ.get('TURN_CREDENTIAL', '')}]
    except Exception as exc:  # خدمة TURN لا تستجيب: نكمل بـ STUN بدل أن تفشل المكالمة كلها
        log.warning('TURN credentials failed: %s', exc)
        ttl = 60
    cache.set('turn_servers', result, ttl)
    return result


def is_multi(call):
    return call.conversation.kind == Conversation.GROUP or call.invited.exists()


def audience(call):
    """من يهمه ما يحدث في المكالمة: أعضاء محادثتها ومن دُعي إليها."""
    return sorted(set(member_ids(call.conversation)) | set(call.invited.values_list('id', flat=True)))


def expire_ringing():
    """اللي ظلت ترن أكثر من دقيقة = فائتة."""
    for call in Call.objects.filter(status=Call.RINGING, created_at__lt=timezone.now() - RING_TIMEOUT):
        finish(call, Call.MISSED)


def call_summary(call):
    # يُحفظ بالعربية دائماً (رسالة في المحادثة يراها الطرفان)، والواجهة الإنجليزية تترجمه عند العرض
    kind = 'مكالمة فيديو' if call.kind == Call.VIDEO else 'مكالمة صوتية'
    if call.status == Call.MISSED:
        return f'{kind} فائتة'
    if call.status == Call.DECLINED:
        return f'{kind} مرفوضة'
    d = call.duration or 0
    return f'{kind} • {d // 60}:{d % 60:02d}'


def finish(call, final_status):
    call.status = final_status
    call.ended_at = timezone.now()
    call.save(update_fields=['status', 'ended_at'])
    # تطلع بالمحادثة مثل واتساب: "مكالمة فيديو • 2:15" أو "مكالمة صوتية فائتة"
    create_message(call.conversation, call.caller, call_summary(call), kind=Message.CALL)
    send_to_users(audience(call), {'type': 'call_ended', 'call_id': call.id, 'status': final_status})


def visible_calls(user):
    """مكالمات محادثاتي، والمكالمات التي دُعيت إليها."""
    ids = Call.objects.filter(Q(conversation__memberships__user=user) | Q(invited=user)).values('id')
    return Call.objects.filter(id__in=ids)


def my_call(request, pk):
    return get_object_or_404(visible_calls(request.user).select_related('conversation'), pk=pk)


@api_view(['GET', 'POST'])
def calls(request):
    if request.method == 'GET':
        # سجل المكالمات. ?filter=missed للفائتة بس
        expire_ringing()
        qs = (visible_calls(request.user).select_related('caller__profile', 'conversation')
              .prefetch_related('invites__invited_by__profile').order_by('-created_at'))
        if request.query_params.get('filter') == 'missed':
            qs = qs.filter(~Q(caller=request.user), status__in=[Call.MISSED, Call.DECLINED])
        return Response(CallSerializer(qs[:100], many=True, context={'request': request}).data)

    # POST {"conversation_id": 5, "kind": "audio"|"video"}
    m = get_object_or_404(Membership, conversation_id=request.data.get('conversation_id'), user=request.user)
    conv = m.conversation
    if conv.kind == Conversation.SAVED:
        raise ValidationError(_('لا يمكنك الاتصال بنفسك'))
    if conv.kind == Conversation.CHANNEL:  # وإلا رنّ هاتف كل مشترك في القناة
        raise ValidationError(_('لا توجد مكالمات في القنوات'))
    if conv.kind == Conversation.DIRECT:
        other = conv.memberships.exclude(user=request.user).values_list('user_id', flat=True).first()
        if other and is_blocked(request.user.id, other):  # الحظر يمنع المكالمة في الاتجاهين
            raise PermissionDenied(_('لا يمكنك الاتصال بهذا الشخص'))
    kind = request.data.get('kind', Call.AUDIO)
    if kind not in (Call.AUDIO, Call.VIDEO):
        raise ValidationError({'kind': 'audio | video'})
    expire_ringing()
    if conv.calls.filter(status__in=[Call.RINGING, Call.ONGOING]).exists():
        raise ValidationError(_('توجد مكالمة جارية في هذه المحادثة'))
    call = Call.objects.create(conversation=conv, caller=request.user, kind=kind)
    call.joined.add(request.user)
    data = CallSerializer(call, context={'request': request}).data
    others = [uid for uid in member_ids(conv) if uid != request.user.id]
    send_to_users(others, {'type': 'call_incoming', 'call': data})
    name = profile_of(request.user).display_name or request.user.username
    group = conv.kind == Conversation.GROUP
    for member in conv.memberships.exclude(user=request.user).select_related('user__profile'):
        body = in_language(member.user, lambda: _('مكالمة فيديو واردة') if kind == Call.VIDEO else _('مكالمة صوتية واردة'))
        send_to_user(member.user, {
            # المجموعة: العنوان اسمها، والنص من يتصل
            'title': f'📞 {conv.title if group else name}', 'body': f'{name}: {body}' if group else body,
            'conversation': conv.id, 'url': f'/chat?c={conv.id}&call={call.id}', 'tag': f'call-{call.id}',
            'lang': in_language(member.user, translation.get_language)})
    return Response({**data, 'ice_servers': ice_servers()}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def answer(request, pk):
    call = my_call(request, pk)
    if call.status not in (Call.RINGING, Call.ONGOING):
        raise ValidationError(_('انتهت المكالمة'))
    already = call.joined.filter(id=request.user.id).exists()
    if not already and call.joined.count() >= MAX_PARTICIPANTS:
        raise ValidationError(_('المكالمة ممتلئة: الحد {n} مشاركين').format(n=MAX_PARTICIPANTS))
    if call.status == Call.RINGING:
        call.status, call.answered_at = Call.ONGOING, timezone.now()
        call.save(update_fields=['status', 'answered_at'])
    call.joined.add(request.user)
    send_to_users(audience(call), {'type': 'call_answered', 'call_id': call.id, 'user_id': request.user.id})
    return Response({**CallSerializer(call, context={'request': request}).data, 'ice_servers': ice_servers()})


@api_view(['POST'])
def decline(request, pk):
    call = my_call(request, pk)
    invite = call.invites.filter(user=request.user).first()
    if invite and not call.joined.filter(id=request.user.id).exists():
        # رفض دعوة إلى مكالمة جارية: تخصّني وحدي، وتبقى المكالمة لمن فيها
        send_to_users(list(call.joined.values_list('id', flat=True)),
                      {'type': 'call_invite_declined', 'call_id': call.id, 'user_id': request.user.id})
        return Response({'ok': True})
    if call.status != Call.RINGING or call.caller_id == request.user.id:
        raise ValidationError(_('لا يمكنك رفض هذه المكالمة'))
    # بالمجموعة الرفض يخصك إنت بس؛ بالثنائية تنتهي المكالمة
    if call.conversation.kind == Conversation.DIRECT:
        finish(call, Call.DECLINED)
    return Response({'ok': True})


@api_view(['POST'])
def end(request, pk):
    call = my_call(request, pk)
    if call.status in (Call.RINGING, Call.ONGOING):
        finish(call, Call.ENDED if call.status == Call.ONGOING else Call.MISSED)
    return Response(CallSerializer(call, context={'request': request}).data)


@api_view(['POST'])
def leave(request, pk):
    """
    مغادرة المكالمة الجماعية: تبقى جارية لمن بقي، وتنتهي حين يغادر آخر مشارك.
    (المكالمة الثنائية: المغادرة = إنهاء، كما في end.)
    """
    call = my_call(request, pk)
    if call.status not in (Call.RINGING, Call.ONGOING):
        return Response(CallSerializer(call, context={'request': request}).data)
    if not is_multi(call):
        finish(call, Call.ENDED if call.status == Call.ONGOING else Call.MISSED)
        return Response(CallSerializer(call, context={'request': request}).data)
    call.joined.remove(request.user)
    # بقي شخص واحد في مكالمة أُضيف إليها آخرون (ليست مجموعة): لا معنى لبقائها، فتنتهي كما في واتساب
    alone = call.conversation.kind != Conversation.GROUP and call.joined.count() <= 1 and call.answered_at
    if not call.joined.exists() or alone:
        finish(call, Call.ENDED if call.answered_at else Call.MISSED)
    else:
        send_to_users(audience(call), {'type': 'call_left', 'call_id': call.id, 'user_id': request.user.id})
    return Response(CallSerializer(call, context={'request': request}).data)


@api_view(['GET'])
def active(request):
    """المكالمة الجارية في محادثة (?conversation=<id>) ليظهر زر «انضمام»: {"call": {...}} أو {"call": null}."""
    expire_ringing()
    call = (Call.objects.filter(conversation_id=request.query_params.get('conversation') or 0,
                                conversation__memberships__user=request.user, status__in=[Call.RINGING, Call.ONGOING])
            .select_related('caller__profile', 'conversation').first())
    return Response({'call': CallSerializer(call, context={'request': request}).data if call else None})


@api_view(['GET'])
def ice(request):
    return Response({'ice_servers': ice_servers()})


@api_view(['GET'])
def ringing(request):
    """
    المكالمة التي ترنّ لي الآن: {"call": {...}} أو {"call": null}. يسأل عنها التطبيق عند فتحه من إشعار مكالمة،
    أو عند عودة الاتصال، لأن حدث call_incoming ربما وصل وهو مغلق.
    """
    expire_ringing()
    me = request.user
    # مكالمة في محادثاتي ترنّ، أو دعوة إلى مكالمة جارية لم تمضِ عليها دقيقة ولم أنضمّ بعد
    invited = CallInvite.objects.filter(user=me, created_at__gte=timezone.now() - RING_TIMEOUT).values('call_id')
    call = (Call.objects.filter(Q(conversation__memberships__user=me, status=Call.RINGING)
                                | Q(id__in=invited, status__in=[Call.RINGING, Call.ONGOING]))
            .exclude(caller=me).exclude(joined=me).select_related('caller__profile', 'conversation')
            .order_by('-created_at').first())
    return Response({'call': CallSerializer(call, context={'request': request}).data if call else None})


@api_view(['POST'])
def upgrade_video(request, pk):
    """تحويل المكالمة الصوتية إلى فيديو (أثناءها): نحدّث نوعها ليظهر صحيحاً في السجل، ونبلغ الطرف الآخر."""
    call = my_call(request, pk)
    if call.status != Call.ONGOING:
        raise ValidationError(_('انتهت المكالمة'))
    if call.kind != Call.VIDEO:
        call.kind = Call.VIDEO
        call.save(update_fields=['kind'])
    send_to_users([uid for uid in audience(call) if uid != request.user.id],
                  {'type': 'call_video', 'call_id': call.id, 'user_id': request.user.id})
    return Response({'ok': True})


@api_view(['POST'])
def invite(request, pk):
    """
    إضافة أشخاص إلى مكالمة جارية (مثل واتساب): {"user_ids": [5, 9]}.
    يرنّ عندهم ويستطيعون الانضمام، وتصير المكالمة الثنائية جماعية (يتصل كل مشارك بالجميع).
    يدعو من هو في المكالمة الآن، ولمن يعرفه فقط (جهات اتصاله ومن يشاركه محادثة)، وما لم يحظر أحدهما الآخر.
    """
    call = my_call(request, pk)
    me = request.user
    if call.status not in (Call.RINGING, Call.ONGOING):
        raise ValidationError(_('انتهت المكالمة'))
    if not call.joined.filter(id=me.id).exists():
        raise PermissionDenied(_('انضمّ إلى المكالمة أولاً'))
    try:
        ids = list(dict.fromkeys(int(i) for i in request.data.get('user_ids') or []))
    except (TypeError, ValueError):
        raise ValidationError({'user_ids': _('قائمة غير صحيحة')})
    joined = set(call.joined.values_list('id', flat=True))
    ids = [i for i in ids if i != me.id and i not in joined]
    if not ids:
        raise ValidationError({'user_ids': _('اختر شخصاً واحداً على الأقل')})
    allowed = known_ids(me.id)
    if any(i not in allowed or is_blocked(me.id, i) for i in ids):
        raise PermissionDenied(_('لا يمكنك إضافة هذا الشخص'))
    if len(joined) + len(ids) > MAX_PARTICIPANTS:
        raise ValidationError(_('المكالمة ممتلئة: الحد {n} مشاركين').format(n=MAX_PARTICIPANTS))
    members = set(member_ids(call.conversation))
    from django.contrib.auth import get_user_model
    targets = list(get_user_model().objects.filter(id__in=ids).select_related('profile'))
    for user in targets:
        if user.id not in members:  # عضو المحادثة يرنّ عنده من جديد فقط، وغيره يُدعى
            CallInvite.objects.update_or_create(call=call, user=user, defaults={'invited_by': me})
    # من في المكالمة: تصير جماعية عندهم (يقبلون اتصال المنضمّين الجدد)
    send_to_users(audience(call), {'type': 'call_invited', 'call_id': call.id, 'user_ids': [u.id for u in targets]})
    data = CallSerializer(call, context={'request': request}).data
    inviter = UserSerializer(me).data
    name = profile_of(me).display_name or me.username
    for user in targets:
        send_to_users([user.id], {'type': 'call_incoming', 'call': {**data, 'peer': None, 'multi': True, 'invited_by': inviter}})
        body = in_language(user, lambda: _('يدعوك إلى مكالمة فيديو') if call.kind == Call.VIDEO else _('يدعوك إلى مكالمة صوتية'))
        send_to_user(user, {'title': f'📞 {name}', 'body': body, 'url': f'/chat?call={call.id}', 'tag': f'call-{call.id}',
                            'lang': in_language(user, translation.get_language)})
    return Response({**data, 'invited': [u.id for u in targets]})
