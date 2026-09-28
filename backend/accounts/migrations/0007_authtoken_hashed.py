import hashlib

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def copy_old_tokens(apps, schema_editor):
    """التوكنات القديمة (نص عادي) ننقلها كـ hash، حتى محد يطلع من حسابه، وبعدها نمسح القديمة."""
    try:
        Token = apps.get_model('authtoken', 'Token')
    except LookupError:
        return
    AuthToken = apps.get_model('accounts', 'AuthToken')
    AuthToken.objects.bulk_create([
        AuthToken(user_id=t.user_id, key_hash=hashlib.sha256(t.key.encode()).hexdigest())
        for t in Token.objects.all()
    ], ignore_conflicts=True)
    Token.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0006_role_university_support'),
        ('authtoken', '0004_alter_tokenproxy_options'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='AuthToken',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('key_hash', models.CharField(max_length=64, unique=True)),
                ('created', models.DateTimeField(auto_now_add=True)),
                ('last_used', models.DateTimeField(blank=True, null=True)),
                ('user_agent', models.CharField(blank=True, max_length=200)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='auth_tokens',
                                           to=settings.AUTH_USER_MODEL)),
            ],
            options={'verbose_name': 'جلسة دخول', 'verbose_name_plural': 'جلسات الدخول'},
        ),
        migrations.RunPython(copy_old_tokens, migrations.RunPython.noop),
    ]
