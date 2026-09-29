"""
ميزات الرسائل: إعادة التوجيه، والبحث، وتثبيت رسالة، والتصويت في الاستطلاعات، ومعاينة الروابط.
"""
import html
import ipaddress
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

from django.core.cache import cache
from django.shortcuts import get_object_or_404
from django.utils.translation import gettext as _
from rest_framework import status
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from config.throttles import SendThrottle, UserThrottle

from . import services
from .fields import copy_encrypted_file
from .models import Conversation, Membership, Message, PollOption, PollVote
from .serializers import MessageSerializer
from .views import as_bool, name_of, require_can_post

MAX_FORWARD_MESSAGES, MAX_FORWARD_TARGETS = 20, 10
SEARCH_WINDOW, SEARCH_RESULTS = 5000, 50
NOT_FORWARDABLE = (Message.SYSTEM, Message.CALL, Message.POLL)


def _ids(value, limit):
    try:
        ids = [int(x) for x in (value or [])]
    except (TypeError, ValueError):
        raise ValidationError(_('قائمة غير صحيحة'))
    return list(dict.fromkeys(ids))[:limit]


# ------------------------------------------------------------------ إعادة التوجيه

@api_view(['POST'])
@throttle_classes([SendThrottle, UserThrottle])
def forward(request):
    """
    {"message_ids": [..حتى 20], "conversation_ids": [..حتى 10]} ← نسخة من كل رسالة في كل محادثة، بعلامة «مُعاد توجيهها».
    الرسائل من محادثات أنا عضو فيها فقط، والمحادثات الهدف أستطيع الإرسال فيها. الملفات تُنسخ مشفّرة كما هي.
    """
    message_ids = _ids(request.data.get('message_ids'), MAX_FORWARD_MESSAGES)
    target_ids = _ids(request.data.get('conversation_ids'), MAX_FORWARD_TARGETS)
    if not message_ids or not target_ids:
        raise ValidationError(_('اختر الرسائل والمحادثات'))
    msgs = list(Message.objects.filter(pk__in=message_ids, conversation__memberships__user=request.user,
                                       deleted_at__isnull=True).exclude(kind__in=NOT_FORWARDABLE).order_by('id'))
    targets = list(Membership.objects.filter(user=request.user, conversation_id__in=target_ids).select_related('conversation'))
    if not msgs or not targets:
        return Response({'detail': _('لم نجد الرسائل أو المحادثات')}, status=status.HTTP_404_NOT_FOUND)
    for m in targets:
        require_can_post(m)
    sent = 0
    for m in targets:
        conv = m.conversation
        for msg in msgs:
            fields = {'kind': msg.kind, 'forwarded': True, 'file_name': msg.file_name, 'file_size': msg.file_size,
                      'duration': msg.duration, 'width': msg.width, 'height': msg.height,
                      'latitude': msg.latitude, 'longitude': msg.longitude}
            if msg.file:
                fields['file'] = copy_encrypted_file(msg.file.name, f'messages/{conv.id}/{os.path.basename(msg.file.name)}')
            services.create_message(conv, request.user, msg.content, **fields)
            sent += 1
    return Response({'sent': sent}, status=status.HTTP_201_CREATED)


# ------------------------------------------------------------------ البحث

@api_view(['GET'])
def search(request):
    """
    ?q=نص (حرفان على الأقل) و ?conversation=<id> (اختياري) ← أحدث 50 رسالة فيها النص.
    النصوص مشفّرة في قاعدة البيانات فلا يمكن البحث فيها بـ SQL: نفك تشفير آخر 5000 رسالة من محادثاتي ونبحث فيها.
    """
    q = (request.query_params.get('q') or '').strip()
    if len(q) < 2:
        return Response([])
    mine = Membership.objects.filter(user=request.user)
    if request.query_params.get('conversation'):
        mine = mine.filter(conversation_id=request.query_params['conversation'])
    cleared = dict(mine.values_list('conversation_id', 'cleared_at'))
    if not cleared:
        return Response([])
    needle = q.casefold()
    qs = (Message.objects.filter(conversation_id__in=list(cleared), deleted_at__isnull=True)
          .exclude(kind__in=[Message.SYSTEM, Message.CALL]).select_related('sender__profile', 'conversation')
          .order_by('-id')[:SEARCH_WINDOW])
    found = []
    for m in qs:
        since = cleared.get(m.conversation_id)
        if since and m.created_at <= since:
            continue  # حذفتُ هذه المحادثة عندي قبل هذه الرسالة
        if needle in f'{m.content}\n{m.file_name}'.casefold():
            found.append(m)
            if len(found) >= SEARCH_RESULTS:
                break
    ser = MessageSerializer(context={'receipts': None})
    return Response([{'message': ser.to_representation(m),
                      'conversation': {'id': m.conversation_id, 'kind': m.conversation.kind, 'title': m.conversation.title}}
                     for m in found])


# ------------------------------------------------------------------ تثبيت رسالة

@api_view(['POST', 'DELETE'])
def pin_message(request, message_id):
    """
    POST ← تثبيت الرسالة أعلى المحادثة (رسالة واحدة: الجديدة تحل محل القديمة). DELETE ← إلغاء التثبيت.
    المحادثة الثنائية: أي من الطرفين. المجموعة: المشرف، أو الجميع إن سمح المشرفون بتعديل المعلومات. القناة: المشرف.
    """
    msg = get_object_or_404(Message.objects.select_related('conversation'), pk=message_id,
                            conversation__memberships__user=request.user)
    conv = msg.conversation
    m = Membership.objects.get(conversation=conv, user=request.user)
    admin = m.role == Membership.ADMIN
    if conv.kind == Conversation.CHANNEL and not admin or conv.kind == Conversation.GROUP and conv.only_admins_edit and not admin:
        raise PermissionDenied(_('تثبيت الرسائل للمشرفين فقط'))
    if request.method == 'POST':
        if msg.deleted_at or msg.kind in (Message.SYSTEM, Message.CALL):
            raise ValidationError(_('لا يمكن تثبيت هذه الرسالة'))
        conv.pinned_message = msg
        conv.save(update_fields=['pinned_message'])
        if conv.kind != Conversation.CHANNEL:
            services.system_message(conv, request.user, f'{name_of(request.user)} ثبّت رسالة')
    elif conv.pinned_message_id == msg.id:
        conv.pinned_message = None
        conv.save(update_fields=['pinned_message'])
    services.send_to_users(services.member_ids(conv) if conv.kind != Conversation.CHANNEL else [request.user.id],
                           {'type': 'conversation_updated', 'conversation_id': conv.id})
    services.broadcast(conv.id, {'type': 'pinned', 'conversation_id': conv.id})
    return Response({'pinned': conv.pinned_message_id})


# ------------------------------------------------------------------ الاستطلاعات

def create_poll(data):
    """يتحقق من الاستطلاع ويعيد دالة تُنشئ خياراته بعد إنشاء الرسالة (قبل بثّها)."""
    from .models import Poll
    options = [str(o).strip()[:100] for o in (data.get('options') or []) if str(o).strip()]
    options = list(dict.fromkeys(options))
    if not (data.get('content') or '').strip():
        raise ValidationError({'content': _('اكتب سؤال الاستطلاع')})
    if not 2 <= len(options) <= 12:
        raise ValidationError({'options': _('من خيارين إلى 12 خياراً')})
    multiple = as_bool(data.get('multiple'))

    def make(msg):
        poll = Poll.objects.create(message=msg, multiple=multiple)
        PollOption.objects.bulk_create([PollOption(poll=poll, text=t, order=i) for i, t in enumerate(options)])
    return make


@api_view(['POST'])
def vote(request, message_id):
    """{"option_ids": [..]} ← صوتي (يحل محل صوتي السابق). قائمة فارغة = سحب الصوت. النتيجة تُبث للجميع."""
    msg = get_object_or_404(Message.objects.select_related('poll'), pk=message_id, kind=Message.POLL,
                            conversation__memberships__user=request.user, deleted_at__isnull=True)
    poll = msg.poll
    chosen = _ids(request.data.get('option_ids'), 12)
    valid = set(poll.options.values_list('id', flat=True))
    if any(o not in valid for o in chosen):
        raise ValidationError(_('خيار غير موجود'))
    if len(chosen) > 1 and not poll.multiple:
        raise ValidationError(_('هذا الاستطلاع باختيار واحد'))
    PollVote.objects.filter(option__poll=poll, user=request.user).delete()
    PollVote.objects.bulk_create([PollVote(option_id=o, user=request.user) for o in chosen])
    msg = Message.objects.select_related('sender__profile', 'reply_to__sender__profile', 'conversation').get(pk=msg.pk)
    return Response(services.message_changed(msg))


# ------------------------------------------------------------------ معاينة الروابط

PREVIEW_TTL = 24 * 3600
MAX_PAGE = 512 * 1024


def _public_host(host):
    """
    حماية SSRF: لا نجلب إلا عناوين عامة على الإنترنت. نرفض localhost والشبكات الداخلية (10.x، 192.168.x...)
    وعناوين الخدمات السحابية الداخلية (169.254.x)، حتى لا يُستعمل خادمنا لاستكشاف شبكته.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            return False
    return bool(infos)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # نتبع التحويلات بأنفسنا لنفحص كل عنوان


def _meta(page, *names):
    for name in names:
        m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']*)' % re.escape(name), page, re.I) \
            or re.search(r'<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']%s["\']' % re.escape(name), page, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ''


def fetch_preview(url):
    for _hop in range(4):
        parts = urllib.parse.urlsplit(url)
        if parts.scheme not in ('http', 'https') or not parts.hostname or parts.port not in (None, 80, 443):
            return None
        if not _public_host(parts.hostname):
            return None
        req = urllib.request.Request(url, headers={'User-Agent': 'WaslBot/1.0 (link preview)', 'Accept': 'text/html'})
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            resp = opener.open(req, timeout=4)
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308) and e.headers.get('Location'):
                url = urllib.parse.urljoin(url, e.headers['Location'])
                continue
            return None
        except (OSError, ValueError):
            return None
        with resp:
            if 'html' not in (resp.headers.get('Content-Type') or ''):
                return None
            page = resp.read(MAX_PAGE).decode(resp.headers.get_content_charset() or 'utf-8', 'replace')
        title = _meta(page, 'og:title', 'twitter:title')
        if not title:
            m = re.search(r'<title[^>]*>(.*?)</title>', page, re.I | re.S)
            title = html.unescape(m.group(1)).strip() if m else ''
        if not title:
            return None
        image = _meta(page, 'og:image', 'twitter:image')
        image = urllib.parse.urljoin(url, image) if image else ''
        return {'url': url, 'title': title[:200], 'description': _meta(page, 'og:description', 'description')[:300],
                'image': image if image.startswith('https://') else '', 'site': parts.hostname.removeprefix('www.')}
    return None


@api_view(['GET'])
@throttle_classes([UserThrottle])
def link_preview(request):
    """?url= ← {url, title, description, image, site} أو {"preview": null}. في الكاش يوماً كاملاً."""
    url = (request.query_params.get('url') or '').strip()[:2000]
    if not url:
        raise ValidationError({'url': _('الرابط مطلوب')})
    key = 'lp:' + url
    data = cache.get(key)
    if data is None:
        data = fetch_preview(url) or {}
        cache.set(key, data, PREVIEW_TTL if data else 3600)
    return Response({'preview': data or None})


# ------------------------------------------------------------------ مجلدات المحادثات

MAX_FOLDERS = 10


def folder_json(f):
    return {'id': f.id, 'name': f.name, 'conversation_ids': sorted(c.id for c in f.conversations.all()), 'order': f.order}


def _folder_data(request, folder):
    name = (request.data.get('name') or '').strip() if 'name' in request.data or folder is None else folder.name
    if not name:
        raise ValidationError({'name': _('اسم المجلد مطلوب')})
    ids = None
    if 'conversation_ids' in request.data:
        ids = _ids(request.data.get('conversation_ids'), 500)
        # محادثاتي فقط
        ids = list(Membership.objects.filter(user=request.user, conversation_id__in=ids).values_list('conversation_id', flat=True))
    return name[:30], ids


@api_view(['GET', 'POST'])
def folders(request):
    """GET ← مجلداتي. POST {name, conversation_ids} ← مجلد جديد (حتى 10)."""
    from .models import ChatFolder
    mine = ChatFolder.objects.filter(owner=request.user).prefetch_related('conversations')
    if request.method == 'GET':
        return Response([folder_json(f) for f in mine])
    if mine.count() >= MAX_FOLDERS:
        raise ValidationError(_('الحد 10 مجلدات'))
    name, ids = _folder_data(request, None)
    f = ChatFolder.objects.create(owner=request.user, name=name, order=mine.count())
    if ids:
        f.conversations.set(ids)
    return Response(folder_json(f), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def folder_detail(request, pk):
    from .models import ChatFolder
    f = get_object_or_404(ChatFolder, pk=pk, owner=request.user)
    if request.method == 'DELETE':
        f.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    name, ids = _folder_data(request, f)
    f.name = name
    f.save(update_fields=['name'])
    if ids is not None:
        f.conversations.set(ids)
    return Response(folder_json(f))
