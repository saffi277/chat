from django.core.management.base import BaseCommand, CommandError

from accounts.models import Profile
from accounts.views import find_user


class Command(BaseCommand):
    """
    يجعل حساباً موجوداً مدير نظام: تظهر له «لوحة الإدارة» في الإعدادات، ويدخل /admin/ أيضاً.
        python manage.py make_admin <اسم المستخدم أو البريد أو الرقم الجامعي>
        python manage.py make_admin <...> --remove     (يسحب الصلاحية)
    """

    help = 'Make an existing account a system admin (or --remove it)'

    def add_arguments(self, parser):
        parser.add_argument('identifier')
        parser.add_argument('--remove', action='store_true')

    def handle(self, identifier, remove=False, **_):
        user = find_user(identifier)
        if not user:
            raise CommandError(f'لا يوجد حساب بهذا المعرّف: {identifier}')
        user.is_staff = user.is_superuser = not remove
        user.save(update_fields=['is_staff', 'is_superuser'])
        if not remove:
            # مدير النظام إداري في التطبيق أيضاً (ينشر في القنوات، ويظهر دوره «إداري»)
            Profile.objects.update_or_create(user=user, defaults={'role': Profile.STAFF, 'requested_role': ''})
        state = 'لم يعد مدير نظام' if remove else 'أصبح مدير نظام: افتح الإعدادات ← لوحة الإدارة'
        self.stdout.write(self.style.SUCCESS(f'{user.username} {state}'))
