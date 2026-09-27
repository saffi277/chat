from django.core.management.base import BaseCommand
from django.utils import timezone

from stories.models import Story


class Command(BaseCommand):
    help = 'يمسح الحالات المنتهية (أكثر من 24 ساعة) وملفاتها. شغّله كل ساعة بـ cron.'

    def handle(self, *args, **options):
        expired = Story.objects.filter(expires_at__lte=timezone.now())
        count = 0
        for story in expired:
            if story.file:
                story.file.delete(save=False)
            story.delete()
            count += 1
        self.stdout.write(f'انمسحت {count} حالة')
