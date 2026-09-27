import io
import shutil
import tempfile
from unittest import mock

from channels.testing import WebsocketCommunicator
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from config.asgi import application

MEDIA = tempfile.mkdtemp()


def png():
    buf = io.BytesIO()
    Image.new('RGB', (10, 10), 'red').save(buf, 'PNG')
    return SimpleUploadedFile('p.png', buf.getvalue(), content_type='image/png')


class Base:
    def register(self, username, display=''):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123',
                                                     'display_name': display}, format='json')
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        c.user = r.data['user']
        c.token = r.data['token']
        return c


@override_settings(MEDIA_ROOT=MEDIA, PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class GroupTests(Base, TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        self.ali, self.sara, self.omar = self.register('ali', 'علي'), self.register('sara', 'سارة'), self.register('omar')

    def test_group_lifecycle(self, _):
        r = self.ali.post('/api/conversations/groups/', {'title': 'رحلة إسطنبول',
                                                         'member_ids': [self.sara.user['id']]}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        g = r.data
        self.assertEqual((g['kind'], g['member_count'], g['my_role']), ('group', 2, 'admin'))
        msgs = self.ali.get(f"/api/conversations/{g['id']}/messages/").data
        self.assertEqual(msgs[0]['kind'], 'system')
        self.assertIn('أنشأ المجموعة', msgs[0]['content'])

        # عضو عادي ما يكدر يضيف أو يغير الاسم
        self.assertEqual(self.sara.post(f"/api/conversations/{g['id']}/members/",
                                        {'user_ids': [self.omar.user['id']]}, format='json').status_code, 403)
        self.assertEqual(self.sara.patch(f"/api/conversations/{g['id']}/", {'title': 'x'}, format='json').status_code, 403)
        # المشرف يضيف
        self.assertEqual(self.ali.post(f"/api/conversations/{g['id']}/members/",
                                       {'user_ids': [self.omar.user['id']]}, format='json').status_code, 201)
        self.assertEqual(self.omar.get(f"/api/conversations/{g['id']}/").data['member_count'], 3)
        # عمر يطلع؛ المشرف يغادر فسارة (أقدم عضو) تصير مشرفة
        self.assertEqual(self.omar.delete(f"/api/conversations/{g['id']}/").status_code, 204)
        self.assertEqual(self.omar.get(f"/api/conversations/{g['id']}/").status_code, 404)
        self.ali.delete(f"/api/conversations/{g['id']}/")
        self.assertEqual(self.sara.get(f"/api/conversations/{g['id']}/").data['my_role'], 'admin')

    def test_filters_favorites_saved(self, _):
        d = self.ali.post('/api/conversations/', {'user_id': self.sara.user['id']}, format='json').data
        g = self.ali.post('/api/conversations/groups/', {'title': 'فريق', 'member_ids': [self.sara.user['id']]},
                          format='json').data
        self.sara.post(f"/api/conversations/{d['id']}/messages/", {'content': 'هلو'}, format='json')
        ids = lambda f: {c['id'] for c in self.ali.get(f'/api/conversations/?filter={f}').data}
        self.assertEqual(ids('groups'), {g['id']})
        self.assertIn(d['id'], ids('unread'))
        self.ali.patch(f"/api/conversations/{d['id']}/", {'is_favorite': True}, format='json')
        self.assertEqual(ids('favorites'), {d['id']})
        self.ali.patch(f"/api/conversations/{d['id']}/", {'is_archived': True}, format='json')
        self.assertNotIn(d['id'], ids('all'))
        self.assertEqual(ids('archived'), {d['id']})
        s1 = self.ali.get('/api/conversations/saved/').data
        s2 = self.ali.get('/api/conversations/saved/').data
        self.assertEqual((s1['id'], s1['kind'], s1['title']), (s2['id'], 'saved', 'الرسائل المحفوظة'))
        self.assertEqual({c['id'] for c in self.ali.get('/api/conversations/?q=سارة').data} & {d['id']}, set())  # archived
        self.assertIn(g['id'], {c['id'] for c in self.ali.get('/api/conversations/?q=فريق').data})

    def test_group_read_status_and_unread(self, _):
        g = self.ali.post('/api/conversations/groups/', {'title': 'G', 'member_ids': [self.sara.user['id'],
                                                         self.omar.user['id']]}, format='json').data
        m = self.ali.post(f"/api/conversations/{g['id']}/messages/", {'content': 'هلو'}, format='json').data
        self.assertEqual(m['status'], 'sent')
        self.assertEqual(self.sara.get('/api/conversations/?filter=groups').data[0]['unread_count'], 2)
        self.sara.patch(f"/api/conversations/{g['id']}/read/")
        last = self.ali.get(f"/api/conversations/{g['id']}/messages/").data[-1]
        self.assertEqual(last['status'], 'sent')  # عمر بعده ما قرا
        self.omar.patch(f"/api/conversations/{g['id']}/read/")
        last = self.ali.get(f"/api/conversations/{g['id']}/messages/").data[-1]
        self.assertEqual((last['status'], last['is_read']), ('read', True))

    def test_media_messages(self, push):
        self.sara.post('/api/push/subscribe/', {'endpoint': 'https://push.example.com/s',
                                                'keys': {'p256dh': 'k', 'auth': 'a'}}, format='json')
        d = self.ali.post('/api/conversations/', {'user_id': self.sara.user['id']}, format='json').data
        url = f"/api/conversations/{d['id']}/messages/"
        r = self.ali.post(url, {'file': png(), 'content': 'شوف'}, format='multipart')
        self.assertEqual((r.status_code, r.data['kind']), (201, 'image'), r.data)
        self.assertTrue(r.data['file_url'].startswith('/media/messages/'))
        self.assertEqual(self.client.get(r.data['file_url']).status_code, 200)
        fake = SimpleUploadedFile('x.png', b'not image', content_type='image/png')
        self.assertEqual(self.ali.post(url, {'file': fake, 'kind': 'image'}, format='multipart').status_code, 400)
        voice = SimpleUploadedFile('v.webm', b'\x1aE\xdf\xa3' + b'0' * 100, content_type='audio/webm')
        r = self.ali.post(url, {'file': voice, 'kind': 'voice', 'duration': '4.5'}, format='multipart')
        self.assertEqual((r.data['kind'], r.data['duration']), ('voice', 4.5))
        self.assertIn('رسالة صوتية', push.call_args.args[1])
        html = SimpleUploadedFile('evil.html', b'<script>alert(1)</script>', content_type='text/html')
        r = self.ali.post(url, {'file': html}, format='multipart')
        self.assertEqual(r.data['kind'], 'file')
        served = self.client.get(r.data['file_url'])
        self.assertEqual(served['Content-Disposition'], 'attachment')  # ما ينفتح بالمتصفح
        media = self.sara.get(f"/api/conversations/{d['id']}/media/?type=media").data
        self.assertEqual((media['counts']['image'], media['counts']['voice'], len(media['results'])), (1, 1, 1))

    def test_reply_edit_delete_pagination(self, _):
        d = self.ali.post('/api/conversations/', {'user_id': self.sara.user['id']}, format='json').data
        url = f"/api/conversations/{d['id']}/messages/"
        first = self.ali.post(url, {'content': 'أول رسالة'}, format='json').data
        r = self.sara.post(url, {'content': 'رد', 'reply_to': first['id']}, format='json').data
        self.assertEqual(r['reply_to']['preview'], 'أول رسالة')
        self.assertEqual(self.sara.patch(f"/api/messages/{first['id']}/", {'content': 'x'}, format='json').status_code, 403)
        e = self.ali.patch(f"/api/messages/{first['id']}/", {'content': 'معدلة'}, format='json').data
        self.assertTrue(e['edited_at'])
        self.assertEqual(self.ali.delete(f"/api/messages/{first['id']}/").status_code, 204)
        msgs = self.ali.get(url).data
        self.assertEqual((msgs[0]['is_deleted'], msgs[0]['content']), (True, ''))
        for i in range(60):
            self.ali.post(url, {'content': f'm{i}'}, format='json')
        page = self.ali.get(url).data
        self.assertEqual(len(page), 50)
        older = self.ali.get(url + f"?before={page[0]['id']}").data
        self.assertEqual(len(older), 12)
        self.assertLess(older[-1]['id'], page[0]['id'])

    def test_location_and_live(self, _):
        d = self.ali.post('/api/conversations/', {'user_id': self.sara.user['id']}, format='json').data
        url = f"/api/conversations/{d['id']}/messages/"
        self.assertEqual(self.ali.post(url, {'kind': 'location', 'latitude': 200, 'longitude': 1},
                                       format='json').status_code, 400)
        m = self.ali.post(url, {'kind': 'location', 'latitude': 33.31, 'longitude': 44.36, 'live_minutes': 15},
                          format='json').data
        self.assertTrue(m['is_live'])
        u = self.ali.patch(f"/api/messages/{m['id']}/location/", {'latitude': 33.4, 'longitude': 44.4}, format='json').data
        self.assertEqual(u['latitude'], 33.4)
        s = self.ali.patch(f"/api/messages/{m['id']}/location/", {'stop': True}, format='json').data
        self.assertFalse(s['is_live'])

    def test_profile_extras(self, _):
        r = self.ali.patch('/api/auth/me/', {'phone': '+964 770 123 4567', 'city': 'بغداد', 'bio': 'هلا', 'theme': 'dark'},
                           format='json')
        self.assertEqual((r.data['phone'], r.data['theme']), ('+9647701234567', 'dark'))
        self.assertEqual(self.ali.patch('/api/auth/me/', {'phone': 'abc'}, format='json').status_code, 400)
        self.assertEqual(self.ali.patch('/api/auth/me/', {'theme': 'pink'}, format='json').status_code, 400)
        other = self.sara.get(f"/api/users/{self.ali.user['id']}/").data
        self.assertEqual(other['city'], 'بغداد')
        self.assertNotIn('theme', other)  # إعدادات خاصة ما تطلع للناس
        self.assertEqual([u['username'] for u in self.sara.get('/api/users/?q=770').data], ['ali'])


class DeliveredTests(Base, TransactionTestCase):
    async def test_delivered_when_device_connects(self):
        from asgiref.sync import sync_to_async
        ali, sara = await sync_to_async(self.register)('ali'), await sync_to_async(self.register)('sara')
        d = await sync_to_async(ali.post)('/api/conversations/', {'user_id': sara.user['id']}, format='json')
        url = f"/api/conversations/{d.data['id']}/messages/"
        m = await sync_to_async(ali.post)(url, {'content': 'هلو'}, format='json')
        self.assertEqual(m.data['status'], 'sent')
        ws = WebsocketCommunicator(application, f'/ws/presence/?token={sara.token}')
        self.assertTrue((await ws.connect())[0])
        await ws.receive_json_from()  # حدث presence
        msgs = await sync_to_async(ali.get)(url)
        self.assertEqual(msgs.data[-1]['status'], 'delivered')
        # ثاني تبويب لنفس المستخدم، يسد واحد: يبقى متصل
        ws2 = WebsocketCommunicator(application, f'/ws/presence/?token={sara.token}')
        await ws2.connect()
        await ws2.disconnect()
        user = await sync_to_async(ali.get)(f"/api/users/{sara.user['id']}/")
        self.assertTrue(user.data['is_online'])
        await ws.disconnect()
        user = await sync_to_async(ali.get)(f"/api/users/{sara.user['id']}/")
        self.assertFalse(user.data['is_online'])
