from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.translation import gettext as _
from rest_framework import serializers, status
from rest_framework.decorators import api_view
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.serializers import UserSerializer, profile_of
from chat.models import Conversation, Membership, Message
from chat.services import create_message, member_ids, send_to_users
from notifications.push import in_language, send_to_user

from .models import Call

RING_TIMEOUT = timedelta(seconds=60)


class CallSerializer(serializers.ModelSerializer):
    caller = UserSerializer(read_only=True)
    duration = serializers.IntegerField(read_only=True)
    direction = serializers.SerializerMethodField()
    peer = serializers.SerializerMethodField()
    conversation_kind = serializers.CharField(source='conversation.kind', read_only=True)
    title = serializers.CharField(source='conversation.title', read_only=True)

    class Meta:
        model = Call
        fields = ['id', 'conversation', 'conversation_kind', 'title', 'caller', 'peer', 'kind', 'status',
                  'direction', 'created_at', 'answered_at', 'ended_at', 'duration']

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
        other = next((m.user for m in obj.conversation.memberships.select_related('user__profile')
                      if m.user_id != me.id), None)
        return UserSerializer(other).data if other else None


def ice_servers():
    # STUN = خادم يساعد الجهاز يعرف عنوانه على الإنترنت. للشبكات الصعبة نحتاج TURN (بالإنتاج)
    return getattr(settings, 'ICE_SERVERS', [{'urls': ['stun:stun.l.google.com:19302']}])


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
    send_to_users(member_ids(call.conversation), {'type': 'call_ended', 'call_id': call.id, 'status': final_status})


def my_call(request, pk):
    return get_object_or_404(Call.objects.select_related('conversation'), pk=pk,
                             conversation__memberships__user=request.user)


@api_view(['GET', 'POST'])
def calls(request):
    if request.method == 'GET':
        # سجل المكالمات. ?filter=missed للفائتة بس
        expire_ringing()
        qs = (Call.objects.filter(conversation__memberships__user=request.user)
              .select_related('caller__profile', 'conversation').order_by('-created_at'))
        if request.query_params.get('filter') == 'missed':
            qs = qs.filter(~Q(caller=request.user), status__in=[Call.MISSED, Call.DECLINED])
        return Response(CallSerializer(qs[:100], many=True, context={'request': request}).data)

    # POST {"conversation_id": 5, "kind": "audio"|"video"}
    m = get_object_or_404(Membership, conversation_id=request.data.get('conversation_id'), user=request.user)
    conv = m.conversation
    if conv.kind == Conversation.SAVED:
        raise ValidationError(_('لا يمكنك الاتصال بنفسك'))
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
    for member in conv.memberships.exclude(user=request.user).select_related('user__profile'):
        body = in_language(member.user, lambda: _('مكالمة فيديو واردة') if kind == Call.VIDEO else _('مكالمة صوتية واردة'))
        send_to_user(member.user, {
            'title': f'📞 {name}', 'body': body,
            'conversation': conv.id, 'url': f'/chat?c={conv.id}&call={call.id}', 'tag': f'call-{call.id}'})
    return Response({**data, 'ice_servers': ice_servers()}, status=status.HTTP_201_CREATED)


@api_view(['POST'])
def answer(request, pk):
    call = my_call(request, pk)
    if call.status not in (Call.RINGING, Call.ONGOING):
        raise ValidationError(_('انتهت المكالمة'))
    if call.status == Call.RINGING:
        call.status, call.answered_at = Call.ONGOING, timezone.now()
        call.save(update_fields=['status', 'answered_at'])
    call.joined.add(request.user)
    send_to_users(member_ids(call.conversation),
                  {'type': 'call_answered', 'call_id': call.id, 'user_id': request.user.id})
    return Response({**CallSerializer(call, context={'request': request}).data, 'ice_servers': ice_servers()})


@api_view(['POST'])
def decline(request, pk):
    call = my_call(request, pk)
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


@api_view(['GET'])
def ice(request):
    return Response({'ice_servers': ice_servers()})
