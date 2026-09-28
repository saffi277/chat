"""
يشفر الملفات القديمة (المرفوعة قبل تفعيل التشفير) بمكانها. آمن تشغله أكثر من مرة.
    python manage.py encrypt_existing_files
"""
from django.core.management.base import BaseCommand

from chat.crypto import FILE_MAGIC, encrypt_bytes
from chat.models import Message
from stories.models import Story


class Command(BaseCommand):
    help = 'تشفير ملفات الرسائل والحالات القديمة'

    def handle(self, *args, **options):
        done = skipped = 0
        for obj in [*Message.objects.exclude(file='').exclude(file=None), *Story.objects.exclude(file='').exclude(file=None)]:
            path = obj.file.path
            try:
                with open(path, 'rb') as f:
                    data = f.read()
            except FileNotFoundError:
                continue
            if data.startswith(FILE_MAGIC):
                skipped += 1
                continue
            tmp = f'{path}.enc-tmp'
            with open(tmp, 'wb') as f:
                f.write(encrypt_bytes(data))
            import os
            os.replace(tmp, path)  # نبدل الملف بخطوة وحدة (ما يضيع إذا انقطع التشغيل بالنص)
            done += 1
        self.stdout.write(f'تشفّر {done} ملف، و{skipped} كانت مشفرة من قبل')
