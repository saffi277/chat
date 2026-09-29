import io
import shutil
import tempfile
from unittest import mock

from django.core.cache import cache
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
        # لا أحد يمنح نفسه دور «تدريسي» بالتسجيل: يبدأ طالباً وطلبه معلّق حتى تعتمده الإدارة
        self.assertEqual((r.data['user']['role'], r.data['user']['requested_role']), ('student', 'faculty'))
        self.pending_login = self.login(identifier='dr_ali', role='faculty')
        from .admin import ProfileAdmin
        from .models import Profile
        from django.contrib.admin.sites import site
        ProfileAdmin(Profile, site).approve_role(mock.MagicMock(), Profile.objects.filter(user__username='dr_ali'))
        self.user = APIClient().post('/api/auth/login/', {'identifier': 'dr_ali', 'password': 'secret123'}, format='json').data['user']

    def test_pending_role_can_sign_in_as_student(self):
        # قبل الاعتماد: يدخل بدور «تدريسي» الذي طلبه، لكن بصلاحيات طالب (والواجهة تُظهر أن طلبه قيد المراجعة)
        r = self.pending_login
        self.assertEqual((r.status_code, r.data['user']['role'], r.data['user']['requested_role']), (200, 'student', 'faculty'))
        self.assertEqual((self.user['role'], self.user['requested_role']), ('faculty', ''))  # بعد الاعتماد
        # طلب «إداري» ثم رفضته الإدارة: يبقى طالباً
        from .admin import ProfileAdmin
        from .models import Profile
        from django.contrib.admin.sites import site
        s = APIClient().post('/api/auth/register/', {'username': 'st1', 'password': 'secret123', 'role': 'staff'}, format='json').data
        ProfileAdmin(Profile, site).reject_role(mock.MagicMock(), Profile.objects.filter(user_id=s['user']['id']))
        p = Profile.objects.get(user_id=s['user']['id'])
        self.assertEqual((p.role, p.requested_role), ('student', ''))

    def login(self, **data):
        return APIClient().post('/api/auth/login/', {'password': 'secret123', **data}, format='json')

    def test_register_saves_role_and_private_fields(self):
        self.assertEqual((self.user['role'], self.user['email'], self.user['university_id']),
                         ('faculty', 'ali@asbat.edu.iq', 'F-2041'))
        other = APIClient().post('/api/auth/register/', {'username': 'x', 'password': 'secret123'}, format='json').data
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + other['token'])
        # لا يرى ملفه قبل أن يضيفه (لا تصفّح للحسابات بتجربة الأرقام)، ثم يضيفه برقمه الجامعي
        self.assertEqual(c.get(f"/api/users/{self.user['id']}/").status_code, 404)
        self.assertEqual(c.post('/api/contacts/', {'identifier': 'F-2041'}, format='json').status_code, 201)
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


class LanguageTests(TestCase):
    """رسائل الخادم تعود بلغة الواجهة (ترويسة Accept-Language)، والعربية هي الافتراضية."""

    def test_errors_follow_accept_language(self):
        c = APIClient()
        body = {'identifier': 'nobody', 'password': 'wrong-pass', 'role': 'student'}
        ar = c.post('/api/auth/login/', body, format='json', HTTP_ACCEPT_LANGUAGE='ar')
        en = c.post('/api/auth/login/', body, format='json', HTTP_ACCEPT_LANGUAGE='en')
        self.assertIn('بيانات الدخول غير صحيحة', ar.data['detail'])
        self.assertIn('Incorrect sign-in details', en.data['detail'])

    def test_language_is_saved_on_the_profile(self):
        r = APIClient().post('/api/auth/register/', {'username': 'lang_user', 'password': 'secret123'}, format='json')
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        self.assertEqual(c.get('/api/auth/me/').data['language'], 'ar')
        self.assertEqual(c.patch('/api/auth/me/', {'language': 'en'}, format='json').data['language'], 'en')
        self.assertEqual(c.patch('/api/auth/me/', {'language': 'fr'}, format='json').status_code, 400)


class MyInfoTests(TestCase):
    """صفحة «معلوماتي»: تعديل البريد الجامعي مع منع تكراره."""

    def client_for(self, username, email=''):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123', 'email': email}, format='json')
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        return c

    def test_change_email(self):
        ali = self.client_for('ali_info')
        self.client_for('sara_info', 'sara@asbat.edu.iq')
        r = ali.patch('/api/auth/me/', {'email': 'ali@asbat.edu.iq', 'display_name': 'علي'}, format='json')
        self.assertEqual((r.data['email'], r.data['display_name']), ('ali@asbat.edu.iq', 'علي'))
        taken = ali.patch('/api/auth/me/', {'email': 'SARA@asbat.edu.iq', 'display_name': 'تغيير'}, format='json')
        self.assertEqual(taken.status_code, 400)
        self.assertIn('email', taken.data)
        me = ali.get('/api/auth/me/').data
        self.assertEqual((me['email'], me['display_name']), ('ali@asbat.edu.iq', 'علي'))  # لم يُحفظ شيء
        self.assertEqual(ali.patch('/api/auth/me/', {'email': 'not-an-email'}, format='json').status_code, 400)


class ContactTests(TestCase):
    """جهات الاتصال الخاصة: لا أحد يرى كل الحسابات، والإضافة بمعرّف تعرفه عن الشخص."""

    def make(self, username, **extra):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123', **extra}, format='json')
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        c.user = r.data['user']
        return c

    def setUp(self):
        cache.clear()  # «من أعرفهم» محفوظة في الكاش دقيقة؛ الاختبارات تعيد استعمال أرقام الحسابات
        self.ali = self.make('ali')
        self.sara = self.make('sara', email='sara@asbat.edu.iq', university_id='S-77')
        self.omar = self.make('omar')
        self.sara.patch('/api/auth/me/', {'phone': '+964 770 123 4567'}, format='json')

    def test_nobody_is_visible_until_added(self):
        self.assertEqual(self.ali.get('/api/users/').data, [])
        self.assertEqual(self.ali.get('/api/users/?q=sa').data, [])
        self.assertEqual(self.ali.get('/api/contacts/').data, [])
        self.assertEqual(self.ali.get(f"/api/users/{self.sara.user['id']}/").status_code, 404)
        # لا إضافة بالرقم الداخلي لشخص لا أعرفه
        r = self.ali.post('/api/contacts/', {'user_id': self.sara.user['id']}, format='json')
        self.assertEqual(r.status_code, 404)

    def test_find_by_exact_identifier_only(self):
        for q in ('S-77', 's-77', 'sara@asbat.edu.iq', 'sara', '@sara', '07701234567', '+964 770 123 4567'):
            r = self.ali.get('/api/users/find/', {'q': q})
            self.assertEqual((r.status_code, r.data.get('username')), (200, 'sara'), q)
            self.assertFalse(r.data['is_contact'])
        for q in ('sar', 'S-7', '770', ''):
            self.assertEqual(self.ali.get('/api/users/find/', {'q': q}).status_code, 404, q)
        self.assertEqual(self.ali.get('/api/users/find/', {'q': 'ali'}).status_code, 404)  # نفسي

    def test_add_list_remove(self):
        r = self.ali.post('/api/contacts/', {'identifier': 'S-77'}, format='json')
        self.assertEqual((r.status_code, r.data['username'], r.data['is_contact']), (201, 'sara', True))
        self.assertEqual(self.ali.post('/api/contacts/', {'identifier': 'sara'}, format='json').status_code, 200)
        self.assertEqual([u['username'] for u in self.ali.get('/api/contacts/').data], ['sara'])
        self.assertEqual([u['username'] for u in self.ali.get('/api/users/?q=sa').data], ['sara'])
        self.assertTrue(self.ali.get(f"/api/users/{self.sara.user['id']}/").data['is_contact'])
        # سارة لم تضفه لكنها تعرفه الآن (أضافها)، فتستطيع رؤيته والرد عليه، دون أن يظهر في جهات اتصالها
        self.assertEqual(self.sara.get(f"/api/users/{self.ali.user['id']}/").data['is_contact'], False)
        self.assertEqual(self.sara.get('/api/contacts/').data, [])
        # عمر لا يرى أحداً منهما
        self.assertEqual(self.omar.get('/api/users/').data, [])
        self.assertEqual(self.ali.delete(f"/api/contacts/{self.sara.user['id']}/").status_code, 204)
        self.assertEqual(self.ali.get('/api/contacts/').data, [])
        self.assertEqual(self.ali.post('/api/conversations/', {'user_id': self.sara.user['id']}, format='json').status_code, 404)

    def test_contacts_only_for_messaging_groups_and_stories(self):
        # لا مراسلة ولا إضافة إلى مجموعة لغريب
        self.assertEqual(self.ali.post('/api/conversations/', {'user_id': self.omar.user['id']}, format='json').status_code, 404)
        g = self.ali.post('/api/conversations/groups/', {'title': 'ش', 'member_ids': [self.omar.user['id']]}, format='json').data
        self.assertEqual(g['member_count'], 1)
        # حالة عمر لا تظهر لعلي
        self.omar.post('/api/stories/', {'kind': 'text', 'text': 'مرحبا'}, format='json')
        self.assertEqual(self.ali.get('/api/stories/').data, [])
        self.ali.post('/api/contacts/', {'identifier': 'omar'}, format='json')
        self.assertEqual([g['user']['username'] for g in self.ali.get('/api/stories/').data], ['omar'])
