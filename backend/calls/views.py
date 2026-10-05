import base64
import hashlib
import hmac
import json
import logging
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone as dt_timezone

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
# كل جهاز في مكالمة يرسل «ما زلتُ فيها» كل 15 ثانية (call.alive عبر الاتصال العام). مكالمة جارية لم يصل من أي مشارك
# فيها شيء منذ ALIVE_FOR تُعدّ منتهية: أُغلق التطبيق أو انقطع الإنترنت قبل «إنهاء»، وإلا بقيت «جارية» إلى الأبد
# ورُفضت كل مكالمة جديدة في المحادثة نفسها («توجد مكالمة جارية»)
ALIVE_FOR = 70  # يتحمّل نبضة أو نبضتين فائتتين (الهاتف يبطّئ مؤقتات التطبيق في الخلفية)
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
      4) TURN_URLS + TURN_SECRET  (خادمنا coturn في deploy/docker-compose.yml: كلمة سر مؤقتة لكل طلب، صالحة يوماً،
         بدل كلمة سر ثابتة يستطيع أي أحد نسخها من المتصفح واستعمال خادمنا للأبد)
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
        elif os.environ.get('TURN_URLS') and os.environ.get('TURN_SECRET'):
            result = [{'urls': turn_urls(), **turn_credentials(os.environ['TURN_SECRET'])}]
            ttl = 6 * 3600  # الكلمة صالحة 24 ساعة، فنجددها قبل انتهائها بوقت كافٍ
        elif os.environ.get('TURN_URLS'):
            result = [{'urls': turn_urls(),
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


def turn_urls():
    return [u.strip() for u in os.environ['TURN_URLS'].split(',') if u.strip()]


def turn_credentials(secret, valid_for=24 * 3600):
    """
    كلمة سر مؤقتة لخادم coturn (طريقة «TURN REST API»، use-auth-secret في coturn): اسم المستخدم وقت انتهاء الصلاحية،
    وكلمة السر توقيعه بالسر المشترك بيننا وبين coturn. يتحقق coturn منها دون أن يسألنا، ويرفضها بعد انتهاء وقتها.
    """
    username = f'{int(time.time()) + valid_for}:wasl'
    digest = hmac.new(secret.encode(), username.encode(), hashlib.sha1).digest()
    return {'username': username, 'credential': base64.b64encode(digest).decode()}


def mark_alive(call_id, user_id):
    """هذا المشارك ما زال في المكالمة الآن (ومتى كان آخر حضور لأي مشارك: لحساب مدتها إن انقطعت)."""
    now = time.time()
    cache.set(f'call_alive:{call_id}:{user_id}', now, ALIVE_FOR)
    cache.set(f'call_seen:{call_id}', now, 24 * 3600)


def is_abandoned(call):
    """مكالمة جارية لم يبقَ فيها أحد فعلاً (لم يصل «ما زلتُ فيها» من أي مشارك منذ ALIVE_FOR ثانية)."""
    if call.status != Call.ONGOING:
        return False
    since = call.answered_at or call.created_at
    if since > timezone.now() - timedelta(seconds=ALIVE_FOR):
        return False  # بدأت للتو: لم يحن وقت أول «ما زلتُ فيها»
    ids = list(call.joined.values_list('id', flat=True))
    return not any(cache.get(f'call_alive:{call.id}:{uid}') for uid in ids)


def expire_calls(calls_qs=None):
    """
    التي ظلت ترن أكثر من دقيقة = فائتة. والجارية التي غادرها الجميع دون «إنهاء» = منتهية، ووقت انتهائها آخر حضور فيها.
    calls_qs: نفحص هذه المكالمات الجارية فقط (مكالمات محادثة، أو مكالماتي) بدل كل مكالمات النظام.
    """
    for call in Call.objects.filter(status=Call.RINGING, created_at__lt=timezone.now() - RING_TIMEOUT):
        finish(call, Call.MISSED)
    if calls_qs is None:
        return
    for call in calls_qs.filter(status=Call.ONGOING):
        if is_abandoned(call):
            seen = cache.get(f'call_seen:{call.id}')
            last = datetime.fromtimestamp(seen, tz=dt_timezone.utc) if seen else None
            finish(call, Call.ENDED, ended_at=max(filter(None, [last, call.answered_at, call.created_at])))


expire_ringing = expire_calls


def call_summary(call):
    # يُحفظ بالعربية دائماً (رسالة في المحادثة يراها الطرفان)، والواجهة الإنجليزية تترجمه عند العرض
    kind = 'مكالمة فيديو' if call.kind == Call.VIDEO else 'مكالمة صوتية'
    if call.status == Call.MISSED:
        return f'{kind} فائتة'
    if call.status == Call.DECLINED:
        return f'{kind} مرفوضة'
    d = call.duration or 0
    return f'{kind} • {d // 60}:{d % 60:02d}'


def finish(call, final_status, ended_at=None):
    ended_at = ended_at or timezone.now()
    # تحديث مشروط: لو أنهى المكالمةَ طلبان في اللحظة نفسها (مثل «إنهاء» مع فحص الانقطاع) تُسجَّل مرة واحدة برسالة واحدة
    if not Call.objects.filter(pk=call.pk, status__in=[Call.RINGING, Call.ONGOING]).update(
            status=final_status, ended_at=ended_at):
        call.refresh_from_db()
        return
    call.status, call.ended_at = final_status, ended_at
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
    expire_calls(conv.calls.all())
    for old in conv.calls.filter(status__in=[Call.RINGING, Call.ONGOING]).select_related('caller__profile'):
        if conv.kind != Conversation.DIRECT:
            raise ValidationError(_('توجد مكالمة جارية في هذه المحادثة'))
        if old.status == Call.RINGING and old.caller_id != request.user.id:
            # اتصلنا ببعض في اللحظة نفسها: نعرض مكالمته الواردة بدل رفض مكالمتي
            return Response({'detail': _('يتصل بك الآن'), 'call': CallSerializer(old, context={'request': request}).data},
                            status=status.HTTP_409_CONFLICT)
        # الثنائية: من يبدأ مكالمة جديدة ليس في مكالمة (الواجهة تمنع ذلك)، فالقديمة بقايا: مكالمتي التي ألغيتُها قبل أن
        # تصل إلى الخادم، أو مكالمة خرجتُ منها دون «إنهاء» (أُعيد تحميل الصفحة، أو انقطع الإنترنت). الجديدة تحل محلها
        finish(old, Call.ENDED if old.status == Call.ONGOING else Call.MISSED)
    call = Call.objects.create(conversation=conv, caller=request.user, kind=kind)
    call.joined.add(request.user)
    mark_alive(call.id, request.user.id)
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
    mark_alive(call.id, request.user.id)
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
    conv_id = request.query_params.get('conversation') or 0
    expire_calls(Call.objects.filter(conversation_id=conv_id, conversation__memberships__user=request.user))
    call = (Call.objects.filter(conversation_id=conv_id,
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
    me = request.user
    expire_calls(Call.objects.filter(invites__user=me))
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
