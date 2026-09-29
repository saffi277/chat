"""الحظر والإبلاغ، والخصوصية، والأجهزة المتصلة، والتحقق بخطوتين، وحذف الحساب."""
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Block, Report
from chat.testing import befriend, open_chat


UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36'


def register(username, **extra):
    r = APIClient(HTTP_USER_AGENT=UA).post('/api/auth/register/', {'username': username, 'password': 'secret123', **extra}, format='json')
    c = APIClient(HTTP_USER_AGENT=UA)
    c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
    c.user, c.token = r.data['user'], r.data['token']
    return c


@override_settings(PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class SafetyTests(TestCase):
    def setUp(self):
        cache.clear()
        self.ali, self.sara = register('ali'), register('sara')
        self.dm = open_chat(self.ali, self.sara.user['id']).data['id']
        befriend(self.sara, self.ali.user['id'])

    def test_block_stops_messages_and_calls_both_ways(self, _):
        url = f'/api/conversations/{self.dm}/messages/'
        self.assertEqual(self.sara.post('/api/blocks/', {'user_id': self.ali.user['id']}, format='json').status_code, 201)
        r = self.ali.post(url, {'content': 'مرحباً'}, format='json')
        self.assertEqual(r.status_code, 403)  # المحظور لا يراسل
        r = self.sara.post(url, {'content': 'مرحباً'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertIn('ألغِ الحظر', r.data['detail'])  # ومن حظر يعرف السبب
        self.assertEqual(self.ali.post('/api/calls/', {'conversation_id': self.dm}, format='json').status_code, 403)
        # من حظرني يختفي من قائمتي، ولا أرى صورته ولا ظهوره
        self.assertNotIn(self.sara.user['id'], [u['id'] for u in self.ali.get('/api/users/').data])
        # من حظرتُه يبقى ظاهراً لي في قائمة المحظورين، وأستطيع إلغاء الحظر
        self.assertEqual([u['id'] for u in self.sara.get('/api/blocks/').data], [self.ali.user['id']])
        self.sara.delete(f"/api/blocks/{self.ali.user['id']}/")
        self.assertEqual(self.ali.post(url, {'content': 'مرحباً'}, format='json').status_code, 201)
        # لا يُحظر غريب لا أعرفه
        self.assertEqual(self.sara.post('/api/blocks/', {'user_id': register('zaid').user['id']}, format='json').status_code, 404)

    def test_report_message_and_block(self, _):
        m = self.ali.post(f'/api/conversations/{self.dm}/messages/', {'content': 'رسالة مزعجة'}, format='json').data
        r = self.sara.post('/api/reports/', {'message_id': m['id'], 'reason': 'spam', 'details': 'تكررت', 'block': True}, format='json')
        self.assertEqual(r.status_code, 201)
        rep = Report.objects.get()
        self.assertEqual((rep.user.username, rep.message_text, rep.reason), ('ali', 'رسالة مزعجة', 'spam'))
        self.assertTrue(Block.objects.filter(blocker__username='sara', blocked__username='ali').exists())
        # لا بلاغ على رسالة في محادثة لست فيها
        self.assertEqual(register('zaid').post('/api/reports/', {'message_id': m['id']}, format='json').status_code, 404)
        self.assertEqual(self.sara.post('/api/reports/', {'user_id': self.ali.user['id'], 'reason': 'x'}, format='json').status_code, 400)

    def test_privacy_last_seen_and_photo(self, _):
        from accounts.models import Profile
        Profile.objects.filter(user_id=self.sara.user['id']).update(avatar='avatars/s.png', is_online=True)
        find = lambda c, uid: next(u for u in c.get('/api/users/').data if u['id'] == uid)
        sara_id = self.sara.user['id']
        self.assertTrue(find(self.ali, sara_id)['is_online'])
        self.sara.patch('/api/auth/me/', {'privacy_last_seen': 'nobody', 'privacy_photo': 'contacts'}, format='json')
        seen = find(self.ali, sara_id)
        self.assertEqual((seen['is_online'], seen['last_seen']), (False, None))
        self.assertIsNotNone(seen['avatar'])  # علي ضمن جهات اتصالها
        omar = register('omar')
        g = self.sara.post('/api/conversations/groups/', {'title': 'g', 'member_ids': [self.ali.user['id']]}, format='json').data
        befriend(self.sara, omar.user['id'])  # سارة (المشرفة) تضيف عمر، وهو ليس من جهات اتصالها
        from accounts.models import Contact
        Contact.objects.filter(owner_id=sara_id, contact_id=omar.user['id']).delete()
        from chat.models import Membership
        Membership.objects.create(conversation_id=g['id'], user_id=omar.user['id'])
        member = next(m['user'] for m in omar.get(f"/api/conversations/{g['id']}/members/").data if m['user']['id'] == sara_id)
        self.assertIsNone(member['avatar'])  # عمر ليس من جهات اتصالها
        # المرسل داخل الرسالة: بلا حالة اتصال أبداً، وبلا صورة إن لم تكن للجميع
        msg = self.sara.post(f'/api/conversations/{self.dm}/messages/', {'content': 'hi'}, format='json').data
        self.assertEqual((msg['sender']['is_online'], msg['sender']['avatar']), (False, None))
        self.assertEqual(self.sara.patch('/api/auth/me/', {'privacy_photo': 'x'}, format='json').status_code, 400)

    def test_read_receipts_off(self, _):
        url = f'/api/conversations/{self.dm}/'
        m = self.ali.post(f'{url}messages/', {'content': 'قرأتِ؟'}, format='json').data
        self.sara.patch('/api/auth/me/', {'read_receipts': False}, format='json')
        self.sara.patch(f'{url}read/')
        self.assertEqual(self.sara.get(url).data['unread_count'], 0)  # غير المقروء يُحسب كالعادة
        mine = next(x for x in self.ali.get(f'{url}messages/').data if x['id'] == m['id'])
        self.assertEqual(mine['status'], 'delivered')  # لا ✓✓ زرقاء
        self.sara.patch('/api/auth/me/', {'read_receipts': True}, format='json')
        s = self.sara.post(f'{url}messages/', {'content': 'نعم'}, format='json').data
        self.ali.patch(f'{url}read/')
        self.sara.patch('/api/auth/me/', {'read_receipts': False}, format='json')
        # متبادلة: من أوقفها لا يرى قراءة الآخرين لرسائله
        theirs = next(x for x in self.sara.get(f'{url}messages/').data if x['id'] == s['id'])
        self.assertEqual(theirs['status'], 'delivered')

    def test_sessions_list_and_terminate(self, _):
        other = APIClient(HTTP_USER_AGENT='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1')
        tok = other.post('/api/auth/login/', {'identifier': 'ali', 'password': 'secret123'}, format='json').data['token']
        rows = self.ali.get('/api/auth/sessions/').data
        self.assertEqual(len(rows), 2)
        self.assertTrue(rows[0]['current'])
        self.assertEqual(rows[0]['device'], 'Chrome • Windows')
        self.assertEqual(rows[1]['device'], 'Safari • iPhone')
        self.ali.delete(f"/api/auth/sessions/{rows[1]['id']}/")
        other.credentials(HTTP_AUTHORIZATION='Token ' + tok)
        self.assertEqual(other.get('/api/auth/me/').status_code, 401)  # خرج ذلك الجهاز فوراً
        self.assertEqual(self.sara.delete(f"/api/auth/sessions/{rows[0]['id']}/").status_code, 404)  # ليست جلستها

    def test_two_step_verification(self, _):
        self.assertEqual(self.ali.post('/api/auth/two-step/', {'password': 'wrong', 'code': '4321'}, format='json').status_code, 400)
        r = self.ali.post('/api/auth/two-step/', {'password': 'secret123', 'code': '4321', 'hint': 'رقم الغرفة'}, format='json')
        self.assertTrue(r.data['two_step'])
        first = APIClient().post('/api/auth/login/', {'identifier': 'ali', 'password': 'secret123'}, format='json').data
        self.assertNotIn('token', first)  # لا توكن بكلمة المرور وحدها
        self.assertEqual((first['two_step'], first['hint']), (True, 'رقم الغرفة'))
        bad = APIClient().post('/api/auth/login/two-step/', {'ticket': first['ticket'], 'code': '0000'}, format='json')
        self.assertEqual(bad.status_code, 400)
        forged = APIClient().post('/api/auth/login/two-step/', {'ticket': 'x:y:z', 'code': '4321'}, format='json')
        self.assertEqual(forged.status_code, 400)
        ok = APIClient().post('/api/auth/login/two-step/', {'ticket': first['ticket'], 'code': '4321'}, format='json').data
        self.assertEqual(ok['user']['username'], 'ali')
        self.ali.delete('/api/auth/two-step/', {'password': 'secret123'}, format='json')
        self.assertIn('token', APIClient().post('/api/auth/login/', {'identifier': 'ali', 'password': 'secret123'}, format='json').data)

    def test_delete_account(self, _):
        g = self.ali.post('/api/conversations/groups/', {'title': 'g', 'member_ids': [self.sara.user['id']]}, format='json').data
        self.ali.post(f'/api/conversations/{self.dm}/messages/', {'content': 'وداعاً'}, format='json')
        self.assertEqual(self.ali.post('/api/auth/delete/', {'password': 'nope'}, format='json').status_code, 400)
        self.assertEqual(self.ali.post('/api/auth/delete/', {'password': 'secret123'}, format='json').status_code, 204)
        self.assertEqual(self.ali.get('/api/auth/me/').status_code, 401)
        from django.contrib.auth import get_user_model
        self.assertFalse(get_user_model().objects.filter(username='ali').exists())
        # المجموعة باقية لسارة وصارت مشرفتها
        self.assertEqual(self.sara.get(f"/api/conversations/{g['id']}/").data['my_role'], 'admin')
