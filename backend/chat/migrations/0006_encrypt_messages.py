from django.db import migrations, models

import chat.fields
import chat.models


def encrypt_existing(apps, schema_editor):
    """الرسائل القديمة (نص عادي) تتشفر، ونعلّم اللي بيها روابط."""
    Message = apps.get_model('chat', 'Message')
    batch = []
    for m in Message.objects.all().iterator(chunk_size=500):
        m.has_link = m.kind == 'text' and ('http://' in (m.content or '') or 'https://' in (m.content or ''))
        batch.append(m)
        if len(batch) >= 500:
            Message.objects.bulk_update(batch, ['content', 'has_link'])  # get_prep_value يشفر
            batch = []
    if batch:
        Message.objects.bulk_update(batch, ['content', 'has_link'])


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0005_message_index'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='has_link',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='message',
            name='content',
            field=chat.fields.EncryptedTextField(blank=True),
        ),
        migrations.AlterField(
            model_name='message',
            name='file',
            field=models.FileField(blank=True, null=True, storage=chat.fields.get_encrypted_storage,
                                   upload_to=chat.models.message_upload_path),
        ),
        migrations.RunPython(encrypt_existing, migrations.RunPython.noop),
    ]
