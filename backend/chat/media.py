"""
التحقق من الملفات المرفوعة بالرسائل. ما نثق بإسم الملف ولا بالنوع اللي يگوله المتصفح وحده:
الصور نفتحها بـ Pillow نتأكد إنها صور حقيقية، ونحدد أحجام قصوى.
"""
import mimetypes

from PIL import Image
from django.utils.translation import gettext as _
from rest_framework.exceptions import ValidationError

from .models import Message

MB = 1024 * 1024
LIMITS = {Message.IMAGE: 10 * MB, Message.VIDEO: 50 * MB, Message.VOICE: 10 * MB, Message.FILE: 25 * MB}
PREFIX = {Message.VIDEO: 'video/', Message.VOICE: 'audio/'}


def guess_kind(upload):
    """إذا الواجهة ما حددت النوع، نخمنه من نوع الملف."""
    ctype = upload.content_type or mimetypes.guess_type(upload.name)[0] or ''
    if ctype.startswith('image/'):
        return Message.IMAGE
    if ctype.startswith('video/'):
        return Message.VIDEO
    if ctype.startswith('audio/'):
        return Message.VOICE
    return Message.FILE


def validate_upload(kind, upload):
    if kind not in LIMITS:
        raise ValidationError({'kind': _('هذا النوع لا يقبل ملفات')})
    if upload.size > LIMITS[kind]:
        raise ValidationError({'file': _('الملف أكبر من {n} ميغابايت').format(n=LIMITS[kind] // MB)})
    if kind == Message.IMAGE:
        try:
            Image.open(upload).verify()
        except Exception:
            raise ValidationError({'file': _('هذا الملف ليس صورة')})
        upload.seek(0)
    elif kind in PREFIX:
        ctype = upload.content_type or mimetypes.guess_type(upload.name)[0] or ''
        if not ctype.startswith(PREFIX[kind]):
            raise ValidationError({'file': _('نوع الملف لا يطابق نوع الرسالة')})
