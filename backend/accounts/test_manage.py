from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from chat.testing import open_chat

from .models import Profile, Report, SupportRequest

User = get_user_model()


def register(username, role='student'):
    r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123', 'role': role,
                                                 'university_id': f'U-{username}'}, format='json')
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
    c.user = r.data['user']
    return c


@mock.patch('notifications.push.webpush')
class ManageTests(TestCase):
    def setUp(self):
        self.boss = register('boss')
        User.objects.filter(username='boss').update(is_staff=True)
        self.ali = register('ali', 'staff')

    def test_only_admins(self, _):
        self.assertEqual(self.ali.get('/api/manage/').status_code, 403)
        self.assertEqual(APIClient().get('/api/manage/').status_code, 401)
        self.assertEqual(self.ali.post(f"/api/manage/roles/{self.ali.user['id']}/", {'approve': True}, format='json').status_code, 403)
        self.assertFalse(self.ali.get('/api/auth/me/').data['is_admin'])
        self.assertTrue(self.boss.get('/api/auth/me/').data['is_admin'])

    def test_role_request_approve_and_reject(self, _):
        data = self.boss.get('/api/manage/').data
        self.assertEqual([(p['username'], p['requested_role'], p['university_id']) for p in data['role_requests']],
                         [('ali', 'staff', 'U-ali')])
        self.assertEqual(data['stats']['users'], 2)
        r = self.boss.post(f"/api/manage/roles/{self.ali.user['id']}/", {'approve': True}, format='json')
        self.assertEqual((r.data['role'], r.data['requested_role']), ('staff', ''))
        self.assertEqual(self.ali.get('/api/auth/me/').data['role'], 'staff')
        self.assertEqual(self.boss.get('/api/manage/').data['role_requests'], [])
        # لا طلب بعد الآن
        self.assertEqual(self.boss.post(f"/api/manage/roles/{self.ali.user['id']}/", {'approve': True}, format='json').status_code, 400)
        dr = register('dr', 'faculty')
        self.boss.post(f"/api/manage/roles/{dr.user['id']}/", {'approve': False}, format='json')
        p = Profile.objects.get(user_id=dr.user['id'])
        self.assertEqual((p.role, p.requested_role), ('student', ''))

    def test_reports(self, _):
        sara = register('sara')
        conv = open_chat(self.ali, sara.user['id']).data['id']
        sara.post('/api/reports/', {'user_id': self.ali.user['id'], 'reason': 'spam', 'details': 'مزعج'}, format='json')
        reports = self.boss.get('/api/manage/').data['reports']
        self.assertEqual(len(reports), 1, conv)
        self.assertEqual((reports[0]['reason'], reports[0]['user']['username'], reports[0]['reporter']['username'],
                          reports[0]['details']), ('spam', 'ali', 'sara', 'مزعج'))
        self.boss.post(f"/api/manage/reports/{reports[0]['id']}/")
        self.assertTrue(Report.objects.get().handled)
        self.assertEqual(self.boss.get('/api/manage/').data['reports'], [])

    def test_forgot_password_reset(self, _):
        APIClient().post('/api/auth/help/', {'kind': 'password', 'identifier': 'U-ali', 'contact': '0770'}, format='json')
        support = self.boss.get('/api/manage/').data['support']
        self.assertEqual((support[0]['kind'], support[0]['user']['username'], support[0]['contact']), ('password', 'ali', '0770'))
        sid = support[0]['id']
        self.assertEqual(self.boss.post(f'/api/manage/support/{sid}/', {'password': '123'}, format='json').status_code, 400)
        self.boss.post(f'/api/manage/support/{sid}/', {'password': 'new-pass-1'}, format='json')
        login = APIClient().post('/api/auth/login/', {'identifier': 'ali', 'password': 'new-pass-1'}, format='json')
        self.assertEqual(login.status_code, 200)
        self.assertTrue(SupportRequest.objects.get().handled)
        self.assertEqual(self.boss.get('/api/manage/').data['support'], [])

    def test_make_admin_command(self, _):
        from io import StringIO

        from django.core.management import call_command
        call_command('make_admin', 'U-ali', stdout=StringIO())
        self.assertTrue(self.ali.get('/api/auth/me/').data['is_admin'])
        self.assertEqual(self.ali.get('/api/manage/').status_code, 200)
        call_command('make_admin', 'ali', '--remove', stdout=StringIO())
        self.assertEqual(self.ali.get('/api/manage/').status_code, 403)

    def test_admin_signs_in_from_any_role_tab(self, _):
        # حساب أُنشئ بـ createsuperuser (بلا ملف، أي «طالب») ودخل من تبويب «إداري»
        User.objects.create_superuser('sa', '', 'secret123')
        r = APIClient().post('/api/auth/login/', {'identifier': 'sa', 'password': 'secret123', 'role': 'staff'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['user']['is_admin'])
        # أما غير المدير فما زال يُطلب منه الدور الصحيح
        r = APIClient().post('/api/auth/login/', {'identifier': 'ali', 'password': 'secret123', 'role': 'faculty'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_make_admin_gives_staff_role(self, _):
        from io import StringIO

        from django.core.management import call_command
        User.objects.create_superuser('sa', '', 'secret123')
        call_command('make_admin', 'sa', stdout=StringIO())
        self.assertEqual(Profile.objects.get(user__username='sa').role, 'staff')
