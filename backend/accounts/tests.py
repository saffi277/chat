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


class UniversityLoginTests(TestCase):
    """الدخول بالاسم أو البريد أو الرقم الجامعي، والتحقق من الدور، وطلبات المساعدة."""

    def setUp(self):
        r = APIClient().post('/api/auth/register/', {
            'username': 'dr_ali', 'password': 'secret123', 'display_name': 'د. علي', 'role': 'faculty',
            'email': 'Ali@Asbat.edu.iq', 'university_id': 'F-2041'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.user = r.data['user']

    def login(self, **data):
        return APIClient().post('/api/auth/login/', {'password': 'secret123', **data}, format='json')

    def test_register_saves_role_and_private_fields(self):
        self.assertEqual((self.user['role'], self.user['email'], self.user['university_id']),
                         ('faculty', 'ali@asbat.edu.iq', 'F-2041'))
        other = APIClient().post('/api/auth/register/', {'username': 'x', 'password': 'secret123'}, format='json').data
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + other['token'])
        public = c.get(f"/api/users/{self.user['id']}/").data
        self.assertEqual(public['role'], 'faculty')
        self.assertNotIn('email', public)
        self.assertNotIn('university_id', public)
        self.assertEqual(other['user']['role'], 'student')  # الافتراضي

    def test_duplicates_rejected(self):
        r = APIClient().post('/api/auth/register/', {'username': 'b', 'password': 'secret123', 'email': 'ali@asbat.edu.iq',
                                                     'university_id': 'f-2041'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertIn('email', r.data)
        self.assertIn('university_id', r.data)

    def test_login_with_any_identifier(self):
        for ident in ('dr_ali', 'ALI@asbat.edu.iq', 'f-2041'):
            r = self.login(identifier=ident, role='faculty')
            self.assertEqual(r.status_code, 200, (ident, r.data))
            self.assertEqual(r.data['user']['id'], self.user['id'])
        self.assertEqual(self.login(username='dr_ali').status_code, 200)  # الطريقة القديمة تبقى تشتغل

    def test_wrong_role_or_password(self):
        r = self.login(identifier='F-2041', role='student')
        self.assertEqual((r.status_code, r.data['role']), (400, 'faculty'))
        self.assertIn('تدريسي', r.data['detail'])
        r = APIClient().post('/api/auth/login/', {'identifier': 'F-2041', 'password': 'nope', 'role': 'student'}, format='json')
        self.assertEqual(r.status_code, 400)
        self.assertNotIn('role', r.data)  # بدون كلمة مرور صحيحة ما نكشف الدور

    def test_help_requests(self):
        from .models import SupportRequest
        c = APIClient()
        self.assertEqual(c.post('/api/auth/help/', {'kind': 'password'}, format='json').status_code, 400)
        r = c.post('/api/auth/help/', {'kind': 'password', 'identifier': 'F-2041', 'contact': '0770'}, format='json')
        self.assertEqual(r.status_code, 201)
        r = c.post('/api/auth/help/', {'kind': 'password', 'identifier': 'nobody'}, format='json')
        self.assertEqual(r.status_code, 201)  # نفس الجواب حتى لو الحساب مو موجود
        self.assertEqual(c.post('/api/auth/help/', {'kind': 'support', 'message': 'ما يفتح'}, format='json').status_code, 201)
        reqs = list(SupportRequest.objects.order_by('id'))
        self.assertEqual([(x.kind, x.user_id) for x in reqs],
                         [('password', self.user['id']), ('password', None), ('support', None)])
