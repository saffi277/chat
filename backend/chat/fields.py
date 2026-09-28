from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.db import models

from .crypto import decrypt_text, encrypt_bytes, encrypt_text


class EncryptedTextField(models.TextField):
    """
    نص يتشفر تلقائياً قبل ما ينحفظ بقاعدة البيانات، وينفك تلقائياً لما نقراه.
    الكود يتعامل وياه كنص عادي؛ بس بالقاعدة نفسها يبين "enc1:...".
    ملاحظة: ما نكدر نبحث داخله بـ SQL (content__icontains)، لأن القاعدة ما تشوف النص.
    """

    def from_db_value(self, value, expression, connection):
        return decrypt_text(value)

    def to_python(self, value):
        return decrypt_text(value) if isinstance(value, str) else value

    def get_prep_value(self, value):
        return encrypt_text(super().get_prep_value(value))


class EncryptedFileStorage(FileSystemStorage):
    """الملفات (صور، صوت، فيديو، مستندات) تنحفظ على القرص مشفرة. تنفك بس وقت ما صاحبها يطلبها (config/media.py)."""

    def _save(self, name, content):
        content.seek(0)
        return super()._save(name, ContentFile(encrypt_bytes(content.read())))


encrypted_storage = EncryptedFileStorage()


def get_encrypted_storage():
    # دالة (مو الكائن نفسه) حتى الـ migrations تكون بسيطة وثابتة
    return encrypted_storage
