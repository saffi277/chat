"""تشغيل العامل الخلفي وحده (الرسائل المجدولة والمختفية): python manage.py run_worker"""
import time

from django.core.management.base import BaseCommand

from chat import worker


class Command(BaseCommand):
    help = 'يرسل الرسائل المجدولة ويحذف الرسائل المختفية كل 15 ثانية'

    def add_arguments(self, parser):
        parser.add_argument('--once', action='store_true', help='دورة واحدة ثم يخرج')

    def handle(self, *args, **opts):
        while True:
            sent, removed = worker.tick()
            if sent or removed:
                self.stdout.write(f'sent={sent} removed={removed}')
            if opts['once']:
                return
            time.sleep(worker.EVERY)
