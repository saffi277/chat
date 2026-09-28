"""
مفاتيح VAPID = هوية السيرفر مالتنا عند خدمات الإشعارات.
المفتاح العام ينطى للمتصفح وقت الاشتراك، والخاص يبقى عدنا ونوقّع بيه كل إشعار،
حتى محد غيرنا يكدر يدز إشعارات بإسم تطبيقنا.

إذا ما محددين المفاتيح بمتغيرات البيئة، نولّدهن مرة وحدة ونحفظهن بملف.
"""
import json
import os
from functools import lru_cache

from cryptography.hazmat.primitives import serialization
from django.conf import settings
from py_vapid import Vapid01, b64urlencode


def _key_file():
    return settings.KEYS_DIR / 'vapid_keys.json'


@lru_cache
def get_keys():
    public = os.environ.get('VAPID_PUBLIC_KEY')
    private = os.environ.get('VAPID_PRIVATE_KEY')
    if public and private:
        return public, private
    path = _key_file()
    if path.exists():
        data = json.loads(path.read_text())
        return data['public'], data['private']
    vapid = Vapid01()
    vapid.generate_keys()
    public = b64urlencode(vapid.public_key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    private = b64urlencode(vapid.private_key.private_numbers().private_value.to_bytes(32, 'big'))
    path.write_text(json.dumps({'public': public, 'private': private}))
    return public, private


@lru_cache
def get_signer():
    return Vapid01.from_raw(get_keys()[1].encode())
