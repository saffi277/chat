from django.core.management.base import BaseCommand

from accounts.presence import reset_presence


class Command(BaseCommand):
    help = 'يصفّر حالة "متصل" للكل (قبل تشغيل عمال السيرفر)'

    def handle(self, *args, **options):
        self.stdout.write(f'انصفّر {reset_presence()} مستخدم')
