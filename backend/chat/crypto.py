"""
تشفير الرسائل والملفات بقاعدة البيانات والقرص (encryption at rest) بـ AES-256-GCM.

- المفتاح (32 بايت) يجي من MESSAGE_KEY (base64) أو ملف KEYS_DIR/message_key (ينسوى تلقائياً أول مرة).
  لازم ينحفظ ويا نسخة احتياطية: إذا ضاع المفتاح، الرسائل المشفرة ما تنقرا.
- GCM يشفر ويتأكد إن محد لعب بالبيانات (إذا تغير حرف واحد، فك التشفير يفشل).
- كل رسالة إلها nonce عشوائي، فنفس النص مرتين يطلع مشفر بشكلين مختلفين.

ليش مو تشفير طرف لطرف (E2EE)؟ هذا يحمي إذا انسرقت قاعدة البيانات أو القرص، وبنفس الوقت يخلي
الإشعارات والبحث وتعدد الأجهزة شغالة. E2EE مرحلة جاية (المفاتيح تصير بأجهزة الناس نفسها).
"""
import base64
import os
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings

PREFIX = 'enc1:'           # علامة: هذا النص مشفر (والقديم بدونها يبقى ينقرا عادي)
FILE_MAGIC = b'WASLENC1'   # أول 8 بايت بالملف المشفر
CHUNK = 64 * 1024          # الملفات تتشفر بقطع، حتى نكدر نفك جزء منها (تشغيل فيديو/صوت من النص)
NONCE = 12
TAG = 16


@lru_cache(maxsize=1)
def _key():
    raw = os.environ.get('MESSAGE_KEY')
    if raw:
        key = base64.b64decode(raw)
    else:
        path = settings.KEYS_DIR / 'message_key'
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(base64.b64encode(AESGCM.generate_key(bit_length=256)).decode())
            os.chmod(path, 0o600)
        key = base64.b64decode(path.read_text().strip())
    if len(key) != 32:
        raise ValueError('MESSAGE_KEY لازم يكون 32 بايت (base64)')
    return AESGCM(key)


# ------------------------------------------------------------------ النصوص

def encrypt_text(text):
    if not text or text.startswith(PREFIX):
        return text
    nonce = os.urandom(NONCE)
    return PREFIX + base64.b64encode(nonce + _key().encrypt(nonce, text.encode(), None)).decode()


def decrypt_text(value):
    if not value or not value.startswith(PREFIX):
        return value  # قديم (قبل التشفير) أو فارغ
    blob = base64.b64decode(value[len(PREFIX):])
    return _key().decrypt(blob[:NONCE], blob[NONCE:], None).decode()


# ------------------------------------------------------------------ الملفات
# الشكل: MAGIC + حجم الأصل (8 بايت) + لكل قطعة: nonce(12) + مشفر(حتى 64KB) + tag(16)

def encrypt_bytes(data):
    out = [FILE_MAGIC, len(data).to_bytes(8, 'big')]
    aes = _key()
    for i in range(0, len(data), CHUNK) or [0]:
        nonce = os.urandom(NONCE)
        # رقم القطعة داخل البيانات الإضافية: محد يكدر يبدل ترتيب القطع
        out.append(nonce + aes.encrypt(nonce, data[i:i + CHUNK], (i // CHUNK).to_bytes(8, 'big')))
    return b''.join(out)


def is_encrypted_file(f):
    pos = f.tell()
    head = f.read(len(FILE_MAGIC))
    f.seek(pos)
    return head == FILE_MAGIC


def plain_size(f):
    f.seek(len(FILE_MAGIC))
    return int.from_bytes(f.read(8), 'big')


def decrypt_range(f, start, end):
    """نفك من البايت start لحد end (مع end) من الملف الأصلي، بس القطع اللازمة."""
    header = len(FILE_MAGIC) + 8
    size = plain_size(f)
    end = min(end, size - 1)
    if start > end:
        return b''
    aes = _key()
    out = []
    first, last = start // CHUNK, end // CHUNK
    for idx in range(first, last + 1):
        plain_len = min(CHUNK, size - idx * CHUNK)
        f.seek(header + idx * (NONCE + CHUNK + TAG))
        blob = f.read(NONCE + plain_len + TAG)
        out.append(aes.decrypt(blob[:NONCE], blob[NONCE:], idx.to_bytes(8, 'big')))
    data = b''.join(out)
    offset = first * CHUNK
    return data[start - offset:end - offset + 1]
