import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

MEDIA = tempfile.mkdtemp()


def png(name='a.png'):
    buf = io.BytesIO()
    Image.new('RGB', (20, 20), 'purple').save(buf, 'PNG')
    return SimpleUploadedFile(name, buf.getvalue(), content_type='image/png')


@override_settings(MEDIA_ROOT=MEDIA)
class ProfileTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def register(self, **extra):
        r = APIClient().post('/api/auth/register/', {'username': 'mustafa', 'password': 'secret123', **extra}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        return client, r.data['user']

    def test_display_name_defaults_to_username(self):
        _, user = self.register()
        self.assertEqual(user['display_name'], 'mustafa')

    def test_register_with_arabic_display_name(self):
        _, user = self.register(display_name='مصطفى محمد')
        self.assertEqual(user['display_name'], 'مصطفى محمد')

    def test_update_name_and_avatar(self):
        client, _ = self.register()
        r = client.patch('/api/auth/me/', {'display_name': '  مصطفى  '}, format='json')
        self.assertEqual(r.data['display_name'], 'مصطفى')
        r = client.patch('/api/auth/me/', {'avatar': png()}, format='multipart')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertTrue(r.data['avatar'].startswith('/media/avatars/'))
        r = client.patch('/api/auth/me/', {'avatar': ''}, format='multipart')
        self.assertIsNone(r.data['avatar'])

    def test_rejects_non_image(self):
        client, _ = self.register()
        bad = SimpleUploadedFile('x.png', b'not an image', content_type='image/png')
        r = client.patch('/api/auth/me/', {'avatar': bad}, format='multipart')
        self.assertEqual(r.status_code, 400)
