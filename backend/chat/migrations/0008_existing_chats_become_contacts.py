"""
عند الانتقال إلى جهات الاتصال الخاصة: من كانت بينهما محادثة ثنائية قبل هذا التحديث
يصبح كلٌّ منهما جهة اتصال للآخر، فلا تفرغ قائمة أحد فجأة.
"""
from django.db import migrations


def forwards(apps, schema_editor):
    Membership = apps.get_model('chat', 'Membership')
    Contact = apps.get_model('accounts', 'Contact')
    pairs = {}
    for conv_id, user_id in Membership.objects.filter(conversation__kind='direct').values_list('conversation_id', 'user_id'):
        pairs.setdefault(conv_id, []).append(user_id)
    rows = set()
    for users in pairs.values():
        if len(users) == 2 and users[0] != users[1]:
            rows.add((users[0], users[1]))
            rows.add((users[1], users[0]))
    Contact.objects.bulk_create([Contact(owner_id=a, contact_id=b) for a, b in rows], ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ('chat', '0007_contacts_channels'),
        ('accounts', '0010_contacts_channels'),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
