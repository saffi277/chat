from django.db import migrations, models

import chat.fields


class Migration(migrations.Migration):

    dependencies = [
        ('stories', '0001_initial'),
        ('chat', '0006_encrypt_messages'),
    ]

    operations = [
        migrations.AlterField(
            model_name='story',
            name='file',
            field=models.FileField(blank=True, null=True, storage=chat.fields.get_encrypted_storage, upload_to='stories/'),
        ),
    ]
