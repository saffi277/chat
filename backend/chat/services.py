# منطق مشترك بين الـ HTTP API والـ WebSocket حتى ما نكرر الكود
import asyncio
import re
import threading

from asgiref.sync import SyncToAsync, async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache
from datetime import timedelta

from django.db.models import Max, OuterRef, Q, Subquery
from django.utils import timezone
from django.utils.translation import gettext as _

from accounts.models import Block, Contact, Profile
from notifications.push import notify_new_message

from .models import Conversation, Membership, Message

PREVIEWS = {
    Message.IMAGE: '📷 صورة',
    Message.VIDEO: '🎬 فيديو',
    Message.VOICE: '🎤 رسالة صوتية',
    Message.FILE: '📎 ملف',
    Message.LOCATION: '📍 موقع',
    Message.POLL: '📊 استطلاع',
}
QUIET = (Message.SYSTEM, Message.CALL)  # ما إلها إشعار Push


def group_name(conversation_id):
    return f'chat_{conversation_id}'


def user_group(user_id):
    return f'user_{user_id}'


_loop = None
_loop_lock = threading.Lock()


def _background_loop():
    """حلقة async وحدة دائمة لكل عملية (بسيرفر الـ HTTP)، حتى البث يعيد استخدام نفس اتصال Redis
    بدل ما يفتح اتصال جديد لكل رسالة (async_to_sync بدون حلقة يسوي حلقة جديدة كل مرة)."""
    global _loop
    with _loop_lock:
        if _loop is None:
            _loop = asyncio.new_event_loop()
            threading.Thread(target=_loop.run_forever, name='channels-send', daemon=True).start()
    return _loop


def _send(group, payload):
    message = {'type': 'chat.event', 'payload': payload}
    layer = get_channel_layer()
    if getattr(SyncToAsync.threadlocal, 'main_event_loop', None) is not None:
        # داخل سيرفر الـ WebSocket (ASGI): نرجع لنفس الحلقة الأساسية
        async_to_sync(layer.group_send)(group, message)
    else:
        # سيرفر الـ HTTP (Gunicorn threads): الحلقة الدائمة
        asyncio.run_coroutine_threadsafe(layer.group_send(group, message), _background_loop()).result(timeout=10)


def broadcast(conversation_id, payload):
    """نبث حدث لكل المتصلين بهاي المحادثة (الفاتحينها هسه)."""
    _send(group_name(conversation_id), payload)


def send_to_users(user_ids, payload):
    """نبث حدث لكل مستخدم على اتصاله العام (حتى لو المحادثة مو مفتوحة عنده)."""
    for user_id in user_ids:
        _send(user_group(user_id), payload)


def _shared_ids(user_id):
    """من يشاركني محادثة ثنائية أو مجموعة. (القنوات لا تُعرّف المشتركين ببعضهم: قد يكونون آلافاً لا يعرف أحدهم الآخر)"""
    mine = (Membership.objects.filter(user_id=user_id).exclude(conversation__kind=Conversation.CHANNEL)
            .values('conversation_id'))
    return set(Membership.objects.filter(conversation_id__in=mine).exclude(user_id=user_id)
               .values_list('user_id', flat=True).distinct())


def contact_ids(user_id):
    """
    من يهمه أن يعرف حالتي (متصل الآن، أو نشرتُ حالة): من يشاركني محادثة، ومن أضافني أو أضفته جهة اتصال.
    قبل كنا نبث لكل الجامعة: 2000 متصل × 2000 = 4 مليون رسالة لما الكل يدخل سوه.
    نحفظها بالكاش دقيقة حتى ما نسأل قاعدة البيانات كل مرة.
    """
    key = f'contacts:{user_id}'
    ids = cache.get(key)
    if ids is None:
        ids = _shared_ids(user_id)
        ids |= set(Contact.objects.filter(owner_id=user_id).values_list('contact_id', flat=True))
        ids |= set(Contact.objects.filter(contact_id=user_id).values_list('owner_id', flat=True))
        ids = sorted(ids)
        cache.set(key, ids, 60)
    return ids


def block_sets(user_id):
    """(من حظرتُهم، ومن حظروني). في الكاش دقيقة مثل contact_ids، ويُمسح عند الحظر أو إلغائه."""
    key = f'blocks:{user_id}'
    sets = cache.get(key)
    if sets is None:
        rows = list(Block.objects.filter(Q(blocker_id=user_id) | Q(blocked_id=user_id)).values_list('blocker_id', 'blocked_id'))
        sets = ({b for a, b in rows if a == user_id}, {a for a, b in rows if b == user_id})
        cache.set(key, sets, 60)
    return sets


def is_blocked(a_id, b_id):
    """هل حظر أحدهما الآخر؟ (لا مراسلة ولا مكالمة بينهما)"""
    i_blocked, blocked_me = block_sets(a_id)
    return b_id in i_blocked or b_id in blocked_me


def known_ids(user_id):
    """
    من أستطيع رؤيته والبحث عنه ومراسلته وإضافته إلى مجموعة: جهات اتصالي، ومن يشاركني محادثة،
    ومن أضافني جهةَ اتصال (حتى أستطيع الرد عليه). غيرهم لا يظهرون لي أبداً.
    من حظرني يختفي عندي (ومن حظرتُه يبقى ظاهراً لي كي أستطيع إلغاء الحظر).
    """
    return set(contact_ids(user_id)) - block_sets(user_id)[1]


def presence_audience(user_id, level=None):
    """
    من يصله «متصل الآن / غير متصل» عني: من يعرفني، بحسب إعداد «آخر ظهور» (الجميع، أو جهات اتصالي، أو لا أحد)،
    ودون من بيني وبينه حظر. level: إعداد «آخر ظهور» إن كان معروفاً (يوفّر استعلاماً).
    """
    if level is None:
        level = Profile.objects.filter(user_id=user_id).values_list('privacy_last_seen', flat=True).first() or Profile.EVERYONE
    if level == Profile.NOBODY:
        return []
    i_blocked, blocked_me = block_sets(user_id)
    ids = set(contact_ids(user_id)) - i_blocked - blocked_me
    if level == Profile.CONTACTS:
        ids &= my_contact_ids(user_id)
    return sorted(ids)


def my_contact_ids(user_id):
    """جهات الاتصال التي أضفتُها أنا فقط (ما يظهر في تبويب جهات الاتصال)."""
    return set(Contact.objects.filter(owner_id=user_id).values_list('contact_id', flat=True))


def forget_contacts(*user_ids):
    """المحادثات أو جهات الاتصال تغيرت (مجموعة جديدة، عضو انضاف، جهة اتصال جديدة): نمسح الكاش."""
    cache.delete_many([f'contacts:{u}' for u in user_ids] + [f'blocks:{u}' for u in user_ids])


def can_broadcast(user):
    """النشر في القنوات وإنشاؤها: للتدريسيين والإداريين فقط (ولمدير النظام)."""
    if user.is_staff or user.is_superuser:
        return True
    profile = getattr(user, 'profile', None)
    return bool(profile and profile.role in (Profile.FACULTY, Profile.STAFF))


def send_to_contacts(user_id, payload, include_self=True):
    i_blocked, blocked_me = block_sets(user_id)
    ids = [u for u in contact_ids(user_id) if u not in i_blocked and u not in blocked_me]
    send_to_users([*ids, *([user_id] if include_self else [])], payload)


def member_ids(conversation):
    return list(conversation.memberships.values_list('user_id', flat=True))


def preview_text(message, tr=lambda text: text):
    """
    النص المختصر الذي يظهر في القائمة وفي الإشعار.
    يُحفظ ويُبث بالعربية دائماً (والواجهة تترجمه)، أما الإشعار فيُترجم لكل مستلم: tr=gettext مع لغته.
    """
    if message.deleted_at:
        return tr('🚫 تم حذف هذه الرسالة')
    if message.kind == Message.LOCATION and message.is_live:
        return tr('📍 موقع مباشر')
    if message.kind == Message.CALL:
        return f'📞 {tr(message.content)}'
    base = PREVIEWS.get(message.kind)
    if base and message.content:
        return f'{tr(base)}: {message.content}'
    return tr(base) if base else message.content


def serialize_message(message):
    from .serializers import MessageSerializer
    return MessageSerializer(message, context={'receipts': receipts_for(message.conversation)}).data


def receipts_for(conversation):
    # القناة: لا علامات قراءة (قد يكون المشتركون آلافاً، وقراءتهم ليست شأن الناشر)
    if conversation.kind == Conversation.CHANNEL:
        return None
    # من أوقف «علامات القراءة»: تظهر رسائله للآخرين «وصلت» ولا تصير زرقاء أبداً
    return [{'user_id': r['user_id'], 'last_delivered_id': r['last_delivered_id'],
             'last_read_id': r['last_read_id'] if r['user__profile__read_receipts'] is not False else 0}
            for r in conversation.memberships.values('user_id', 'last_delivered_id', 'last_read_id', 'user__profile__read_receipts')]


def post_error(membership, check_slow=True):
    """
    هل يستطيع هذا العضو الإرسال الآن؟ يعيد None، أو (رمز، نص الخطأ بلغة المستخدم).
    يُستعمل في الـ HTTP والـ WebSocket والرسائل المجدولة، فالقاعدة واحدة في كل مكان.
    """
    conv = membership.conversation
    admin = membership.role == Membership.ADMIN
    if conv.kind == Conversation.DIRECT:
        other = conv.memberships.exclude(user_id=membership.user_id).values_list('user_id', flat=True).first()
        if other:
            i_blocked, blocked_me = block_sets(membership.user_id)
            if other in i_blocked:
                return 'blocked', _('حظرت هذا الشخص. ألغِ الحظر لتراسله')
            if other in blocked_me:
                return 'blocked', _('لا يمكنك مراسلة هذا الشخص')
    if conv.kind == Conversation.CHANNEL and not admin:
        return 'not_allowed', _('النشر في القناة لمشرفيها فقط')
    if conv.kind == Conversation.GROUP and not admin:
        if conv.only_admins_post:
            return 'not_allowed', _('الإرسال في هذه المجموعة للمشرفين فقط')
        if check_slow and conv.slow_mode:
            last = (conv.messages.filter(sender_id=membership.user_id).exclude(kind__in=QUIET)
                    .order_by('-id').values_list('created_at', flat=True).first())
            if last:
                wait = int((last + timedelta(seconds=conv.slow_mode) - timezone.now()).total_seconds()) + 1
                if wait > 0:
                    return 'slow_mode', _('الوضع البطيء مفعّل: يمكنك الإرسال بعد {n} ثانية').format(n=wait)
    return None


MENTION_RE = re.compile(r'@([\w.]+)')


def mentioned_ids(conversation, sender, content):
    """الإشارة بـ @اسم_المستخدم في المجموعات: من ذُكر من الأعضاء (يصله إشعار حتى لو كتم المجموعة)."""
    if conversation.kind != Conversation.GROUP or '@' not in (content or ''):
        return []
    names = {n.lower() for n in MENTION_RE.findall(content)}
    if not names:
        return []
    return [uid for uid, username in Membership.objects.filter(conversation=conversation).exclude(user=sender)
            .values_list('user_id', 'user__username') if username.lower() in names]


def create_message(conversation, sender, content='', silent=False, after_create=None, **fields):
    """
    1) نخزن الرسالة بالـ Database  2) نبثها للكل  3) إشعار Push (إلا إن كانت «دون إشعار»)  4) نرجعها JSON.
    في محادثة رسائلها مختفية: نحدد وقت حذفها من الآن.
    """
    kind = fields.get('kind', Message.TEXT)
    if conversation.disappear_after and kind not in QUIET and 'expires_at' not in fields:
        fields['expires_at'] = timezone.now() + timedelta(seconds=conversation.disappear_after)
    msg = Message.objects.create(conversation=conversation, sender=sender, content=content, **fields)
    if after_create:  # مثل خيارات الاستطلاع: قبل البث حتى تصل الرسالة كاملة
        after_create(msg)
    # المرسل طبعاً "قرا" رسالته
    Membership.objects.filter(conversation=conversation, user=sender).update(
        last_read_id=msg.id, last_delivered_id=msg.id)
    # "وصلت ✓✓" لكل عضو جهازه متصل هسه (الرسالة راح توصله مباشرة): استعلام واحد لكل الأعضاء،
    # بدل ما كل جهاز يكتب بقاعدة البيانات لحاله (مجموعة 40 شخص كانت = 80 عملية لكل رسالة)
    online = list(Membership.objects.filter(conversation=conversation, user__profile__connections__gt=0)
                  .exclude(user=sender).values_list('user_id', flat=True))
    if online:
        Membership.objects.filter(conversation=conversation, user_id__in=online, last_delivered_id__lt=msg.id).update(
            last_delivered_id=msg.id)
    data = serialize_message(msg)
    # للي فاتحين المحادثة: الرسالة نفسها
    broadcast(conversation.id, {'type': 'message', 'message': data})
    if online:
        broadcast(conversation.id, {'type': 'delivered', 'user_id': online[0] if len(online) == 1 else 0,
                                    'message_id': msg.id})
    # لكل عضو على اتصاله العام: حتى تتحدث قائمته
    send_to_users(member_ids(conversation), {'type': 'inbox', 'message': data})
    if msg.kind not in QUIET and not silent:
        notify_new_message(msg, lambda tr: preview_text(msg, tr), mentioned=mentioned_ids(conversation, sender, content))
    return data


def system_message(conversation, actor, text):
    """رسالة رمادية بالنص مثل "مصطفى أضاف زينب"."""
    return create_message(conversation, actor, text, kind=Message.SYSTEM)


def message_changed(message):
    """بعد تعديل أو حذف أو تحديث موقع: نبلغ الكل بالنسخة الجديدة."""
    data = serialize_message(message)
    broadcast(message.conversation_id, {'type': 'message_updated', 'message': data})
    send_to_users(member_ids(message.conversation), {'type': 'inbox', 'message': data})
    return data


def mark_read(conversation, user):
    """المستخدم فتح المحادثة: كل اللي بيها صار مقروء."""
    last = conversation.messages.aggregate(m=Max('id'))['m'] or 0
    updated = Membership.objects.filter(conversation=conversation, user=user, last_read_id__lt=last).update(
        last_read_id=last)
    if not updated:
        return 0
    Membership.objects.filter(conversation=conversation, user=user, last_delivered_id__lt=last).update(
        last_delivered_id=last)
    # علامات القراءة موقفة: نحسب غير المقروء كالعادة، لكن المرسل يرى «وصلت» فقط
    if not getattr(getattr(user, 'profile', None), 'read_receipts', True):
        broadcast(conversation.id, {'type': 'delivered', 'user_id': user.id, 'message_id': last})
        return updated
    # للمحادثات الثنائية نحدث is_read على الرسائل نفسها (الواجهة القديمة تعتمد عليه)
    if conversation.kind == Conversation.DIRECT:
        conversation.messages.filter(is_read=False).exclude(sender=user).update(is_read=True)
    broadcast(conversation.id, {'type': 'read', 'reader_id': user.id, 'message_id': last})
    return updated


def mark_delivered(user, conversation_ids=None):
    """الرسائل وصلت لجهاز المستخدم (عنده اتصال مفتوح): نحدّث ✓ إلى ✓✓.
    استعلام واحد يجيب آخر رسالة لكل محادثة (بدل استعلام لكل محادثة)."""
    last_id = Message.objects.filter(conversation_id=OuterRef('conversation_id')).order_by('-id').values('id')[:1]
    memberships = Membership.objects.filter(user=user).annotate(last=Subquery(last_id))
    if conversation_ids is not None:
        memberships = memberships.filter(conversation_id__in=conversation_ids)
    for m in memberships:
        if m.last and m.last > m.last_delivered_id:
            Membership.objects.filter(pk=m.pk, last_delivered_id__lt=m.last).update(last_delivered_id=m.last)
            broadcast(m.conversation_id, {'type': 'delivered', 'user_id': user.id, 'message_id': m.last})


def soft_delete(message):
    """نمسح المحتوى والملف، ونخلي أثر "تم حذف هذه الرسالة"."""
    if message.file:
        message.file.delete(save=False)
    message.content = ''
    message.file = None
    message.file_name = ''
    message.latitude = message.longitude = None
    message.live_until = None
    message.deleted_at = timezone.now()
    message.save()
    return message_changed(message)


def remove_message(message):
    """حذف نهائي (للرسائل المختفية): تختفي من المحادثة عند الجميع، مع ملفها."""
    conv, mid, stored = message.conversation, message.id, message.file
    # حذف الصف أولاً: إن سبقنا عامل آخر إليه (0 صفوف) فلا نكرر البث
    deleted, _rows = Message.objects.filter(pk=mid).delete()
    if not deleted:
        return
    if stored:
        stored.delete(save=False)
    broadcast(conv.id, {'type': 'message_removed', 'message_id': mid})
    send_to_users(member_ids(conv), {'type': 'conversation_updated', 'conversation_id': conv.id})
