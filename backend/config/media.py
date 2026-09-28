"""
تقديم الملفات المرفوعة (صور، صوت، فيديو، مستندات، حالات).

الحماية:
1) **روابط موقّعة**: ملفات الرسائل والحالات ما تنفتح إلا برابط فيه توقيع (HMAC) ووقت انتهاء، والسيرفر
   يطلعه بس للي يشوف الرسالة. يعني لو أحد عرف مسار الملف، بدون التوقيع ما يكدر يفتحه.
2) **الملف مشفر على القرص** (chat/crypto.py): نفكه هنا وقت الطلب بس، وحتى جزء منه (Range)
   حتى الفيديو والصوت يشتغلون ويتقدمون (الآيفون يطلب الملف قطع).
3) أي شي مو صورة/صوت/فيديو نجبر المتصفح ينزله بدل ما يفتحه (حتى ملف HTML ما يشغل JavaScript علينا).
"""
import hashlib
import hmac
import mimetypes
import re
import time

from django.conf import settings
from django.http import Http404, HttpResponse, StreamingHttpResponse
from django.utils._os import safe_join
from django.views.static import serve

from chat.crypto import decrypt_range, is_encrypted_file, plain_size

SAFE = ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/', 'video/')
PROTECTED = ('messages/', 'stories/')   # هذني يحتاجن توقيع. الصور الشخصية وصور المجموعات عادية
WINDOW = 6 * 3600                       # الرابط يبقى صالح 6-12 ساعة (ثابت خلال الفترة حتى المتصفح يخزنه بالكاش)
STREAM = 1024 * 1024


def _sig(path, exp):
    return hmac.new(settings.SECRET_KEY.encode(), f'{path}:{exp}'.encode(), hashlib.sha256).hexdigest()[:32]


def signed_url(name):
    """رابط /media/... للملف. ملفات الرسائل والحالات ياخذن توقيع ووقت انتهاء."""
    if not name:
        return None
    url = f'{settings.MEDIA_URL}{name}'
    if not name.startswith(PROTECTED):
        return url
    exp = (int(time.time()) // WINDOW + 2) * WINDOW
    return f'{url}?e={exp}&s={_sig(name, exp)}'


def _valid(request, path):
    try:
        exp = int(request.GET.get('e', '0'))
    except ValueError:
        return False
    return exp > time.time() and hmac.compare_digest(request.GET.get('s', ''), _sig(path, exp))


def _headers(response, path, ctype):
    response['X-Content-Type-Options'] = 'nosniff'
    response['Accept-Ranges'] = 'bytes'
    response['Cache-Control'] = 'private, max-age=3600'
    if not ctype.startswith(SAFE):
        response['Content-Disposition'] = 'attachment'
        response['Content-Type'] = 'application/octet-stream'
    return response


def media(request, path):
    if path.startswith(PROTECTED) and not _valid(request, path):
        return HttpResponse('الرابط غير صالح أو منتهي', status=403)
    try:
        full = safe_join(settings.MEDIA_ROOT, path)
        f = open(full, 'rb')
    except (OSError, ValueError):
        raise Http404
    ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    if not is_encrypted_file(f):
        f.close()  # ملف قديم قبل التشفير
        return _headers(serve(request, path, document_root=settings.MEDIA_ROOT), path, ctype)

    size = plain_size(f)
    start, end, status = 0, size - 1, 200
    match = re.match(r'bytes=(\d*)-(\d*)', request.headers.get('Range', ''))
    if match and size:
        a, b = match.groups()
        if a:
            start, end = int(a), int(b) if b else size - 1
        elif b:  # آخر N بايت
            start, end = max(0, size - int(b)), size - 1
        end = min(end, size - 1)
        if start > end:
            f.close()
            resp = HttpResponse(status=416)
            resp['Content-Range'] = f'bytes */{size}'
            return resp
        status = 206

    def chunks():
        try:
            pos = start
            while pos <= end:
                stop = min(end, pos + STREAM - 1)
                yield decrypt_range(f, pos, stop)
                pos = stop + 1
        finally:
            f.close()

    resp = StreamingHttpResponse(chunks(), status=status, content_type=ctype)
    resp['Content-Length'] = str(end - start + 1 if size else 0)
    if status == 206:
        resp['Content-Range'] = f'bytes {start}-{end}/{size}'
    return _headers(resp, path, ctype)

