import io
import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from .models import Story

MEDIA = tempfile.mkdtemp()


@override_settings(MEDIA_ROOT=MEDIA)
class StoryTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def register(self, username):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123'}, format='json')
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        c.user = r.data['user']
        return c

    def test_story_flow(self):
        ali, sara = self.register('ali'), self.register('sara')
        buf = io.BytesIO()
        Image.new('RGB', (10, 10), 'blue').save(buf, 'PNG')
        img = SimpleUploadedFile('s.png', buf.getvalue(), content_type='image/png')
        s1 = ali.post('/api/stories/', {'file': img, 'text': 'بحيرة'}, format='multipart').data
        self.assertEqual(s1['kind'], 'image')
        self.assertEqual(ali.post('/api/stories/', {'text': 'هلا', 'background': 'red'}, format='json').status_code, 400)
        s2 = ali.post('/api/stories/', {'text': 'صباح الخير', 'background': '#5b5cf0'}, format='json').data
        feed = sara.get('/api/stories/').data
        self.assertEqual((len(feed), feed[0]['all_seen'], len(feed[0]['stories'])), (1, False, 2))
        sara.post(f"/api/stories/{s1['id']}/view/")
        sara.post(f"/api/stories/{s1['id']}/view/")  # مرتين = مشاهدة وحدة
        sara.post(f"/api/stories/{s2['id']}/view/")
        self.assertTrue(sara.get('/api/stories/').data[0]['all_seen'])
        mine = ali.get('/api/stories/').data[0]
        self.assertTrue(mine['is_me'])
        self.assertEqual(mine['stories'][0]['views_count'], 1)
        self.assertEqual(len(ali.get(f"/api/stories/{s1['id']}/viewers/").data), 1)
        self.assertEqual(sara.get(f"/api/stories/{s1['id']}/viewers/").status_code, 404)
        self.assertEqual(len(sara.get('/api/stories/?kind=image').data[0]['stories']), 1)
        # بعد 24 ساعة تختفي
        Story.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(sara.get('/api/stories/').data, [])
        call_command('cleanup_stories', stdout=io.StringIO())
        self.assertEqual(Story.objects.count(), 0)
