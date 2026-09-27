"""
تقديم الملفات المرفوعة بالتطوير. ما نستخدم static() العادي لأن أي أحد يكدر يرفع ملف
HTML أو SVG، ولو انفتح من نفس عنوان السيرفر ممكن يشغّل JavaScript (هجوم XSS).
فأي شي مو صورة/صوت/فيديو نجبر المتصفح ينزله بدل ما يفتحه.
بالإنتاج هذا شغل Nginx أو خدمة تخزين، بنفس القواعد.
"""
import mimetypes

from django.conf import settings
from django.views.static import serve

SAFE = ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'audio/', 'video/')


def media(request, path):
    response = serve(request, path, document_root=settings.MEDIA_ROOT)
    ctype = mimetypes.guess_type(path)[0] or 'application/octet-stream'
    response['X-Content-Type-Options'] = 'nosniff'
    if not ctype.startswith(SAFE):
        response['Content-Disposition'] = 'attachment'
        response['Content-Type'] = 'application/octet-stream'
    return response
