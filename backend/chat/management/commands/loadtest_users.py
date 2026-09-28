"""
ينشئ مستخدمين وهميين لاختبار الضغط (مثلاً 2000 طالب) ويا محادثات بينهم، ويكتب توكناتهم بملف JSON.
    python manage.py loadtest_users --count 2000 --out /tmp/lt_users.json
ما يستخدم بالإنتاج. للحذف: --delete
"""
import json
import secrets

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Profile
from chat.models import Conversation, Membership

User = get_user_model()
PREFIX = 'lt'


class Command(BaseCommand):
    help = 'مستخدمين وهميين لاختبار الضغط'

    def add_arguments(self, parser):
        parser.add_argument('--count', type=int, default=2000)
        parser.add_argument('--friends', type=int, default=3, help='كم محادثة ثنائية لكل مستخدم')
        parser.add_argument('--group-size', type=int, default=40)
        parser.add_argument('--out', default='/tmp/lt_users.json')
        parser.add_argument('--delete', action='store_true')

    @transaction.atomic
    def handle(self, count, friends, group_size, out, delete, **_):
        old = User.objects.filter(username__startswith=f'{PREFIX}_')
        Conversation.objects.filter(memberships__user__in=old).delete()
        old.delete()
        if delete:
            self.stdout.write('انحذفوا')
            return
        password = make_password('loadtest123')  # نفس الهاش للكل حتى الإنشاء يكون سريع
        users = User.objects.bulk_create([User(username=f'{PREFIX}_{i}', password=password) for i in range(count)])
        Profile.objects.bulk_create([Profile(user=u, display_name=f'طالب {i}') for i, u in enumerate(users)])
        from accounts.tokens import issue_token_bulk
        tokens = issue_token_bulk(users)

        convs = {u.id: [] for u in users}
        pairs = [(users[i], users[(i + k) % count]) for i in range(count) for k in range(1, friends + 1) if i < (i + k) % count]
        direct = Conversation.objects.bulk_create([Conversation(kind=Conversation.DIRECT, created_by=a) for a, _ in pairs])
        members = []
        for c, (a, b) in zip(direct, pairs):
            members += [Membership(conversation=c, user=a), Membership(conversation=c, user=b)]
            convs[a.id].append(c.id)
            convs[b.id].append(c.id)
        groups = Conversation.objects.bulk_create([
            Conversation(kind=Conversation.GROUP, title=f'شعبة {g + 1}', created_by=users[g * group_size])
            for g in range(max(1, count // group_size))])
        for g, c in enumerate(groups):
            for u in users[g * group_size:(g + 1) * group_size]:
                members.append(Membership(conversation=c, user=u, role=Membership.MEMBER))
                convs[u.id].append(c.id)
        Membership.objects.bulk_create(members)
        data = [{'id': u.id, 'username': u.username, 'token': tokens[u.id], 'convs': convs[u.id]} for u in users]
        with open(out, 'w') as f:
            json.dump(data, f)
        self.stdout.write(f'{count} مستخدم، {len(direct)} محادثة ثنائية، {len(groups)} مجموعة → {out}')
