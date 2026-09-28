"""مساعدات الاختبارات: المراسلة صارت لجهات الاتصال فقط، فنضيف الطرف الآخر أولاً كما يفعل المستخدم."""
from accounts.models import Contact

from . import services


def befriend(client, *user_ids):
    """صاحب client يضيف هؤلاء إلى جهات اتصاله."""
    me = client.get('/api/auth/me/').data['id']
    for uid in user_ids:
        Contact.objects.get_or_create(owner_id=me, contact_id=uid)
    services.forget_contacts(me, *user_ids)


def open_chat(client, user_id):
    """يضيفه جهة اتصال ثم يفتح المحادثة الثنائية معه (الرد من POST /api/conversations/)."""
    befriend(client, user_id)
    return client.post('/api/conversations/', {'user_id': user_id}, format='json')
