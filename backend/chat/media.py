"""
التحقق من الملفات المرفوعة بالرسائل. ما نثق بإسم الملف ولا بالنوع اللي يگوله المتصفح وحده:
الصور نفتحها بـ Pillow نتأكد إنها صور حقيقية، ونحدد أحجام قصوى.
"""
import mimetypes

from PIL import Image
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
        raise ValidationError({'kind': 'هذا النوع ما يقبل ملفات'})
    if upload.size > LIMITS[kind]:
        raise ValidationError({'file': f'الملف أكبر من {LIMITS[kind] // MB} ميگا'})
    if kind == Message.IMAGE:
        try:
            Image.open(upload).verify()
        except Exception:
            raise ValidationError({'file': 'هذا مو صورة'})
        upload.seek(0)
    elif kind in PREFIX:
        ctype = upload.content_type or mimetypes.guess_type(upload.name)[0] or ''
        if not ctype.startswith(PREFIX[kind]):
            raise ValidationError({'file': 'نوع الملف ما يطابق نوع الرسالة'})
