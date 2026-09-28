import io
import shutil
import tempfile
from unittest import mock

from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from chat.testing import befriend, open_chat
from config.asgi import application

MEDIA = tempfile.mkdtemp()


def png():
    buf = io.BytesIO()
    Image.new('RGB', (10, 10), 'red').save(buf, 'PNG')
    return SimpleUploadedFile('p.png', buf.getvalue(), content_type='image/png')


class Base:
    def register(self, username, display='', role='student'):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123',
                                                     'display_name': display, 'role': role}, format='json')
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
        befriend(self.ali, self.sara.user['id'], self.omar.user['id'])

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
        d = open_chat(self.ali, self.sara.user['id']).data
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
        d = open_chat(self.ali, self.sara.user['id']).data
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
        d = open_chat(self.ali, self.sara.user['id']).data
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
        d = open_chat(self.ali, self.sara.user['id']).data
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
        r = self.ali.patch('/api/auth/me/', {'phone': '+964 770 123 4567', 'city': 'بغداد', 'bio': 'هلا', 'mode': 'dark'},
                           format='json')
        self.assertEqual((r.data['phone'], r.data['mode'], r.data['theme']), ('+9647701234567', 'dark', 'default'))
        self.assertEqual(self.ali.patch('/api/auth/me/', {'phone': 'abc'}, format='json').status_code, 400)
        self.assertEqual(self.ali.patch('/api/auth/me/', {'mode': 'pink'}, format='json').status_code, 400)
        other = self.sara.get(f"/api/users/{self.ali.user['id']}/").data
        self.assertEqual(other['city'], 'بغداد')
        self.assertNotIn('mode', other)  # إعدادات خاصة ما تطلع للناس
        self.assertEqual([u['username'] for u in self.sara.get('/api/users/?q=770').data], ['ali'])

    def test_pin_react_star_clear(self, _):
        d = open_chat(self.ali, self.sara.user['id']).data
        g = self.ali.post('/api/conversations/groups/', {'title': 'الشلة', 'member_ids': [self.sara.user['id']]},
                          format='json').data
        m = self.ali.post(f"/api/conversations/{d['id']}/messages/", {'content': 'هلو'}, format='json').data
        # تثبيت: المثبتة تطلع أول حتى لو أقدم
        self.assertTrue(self.ali.patch(f"/api/conversations/{d['id']}/", {'is_pinned': True}, format='json').data['is_pinned'])
        self.ali.post(f"/api/conversations/{g['id']}/messages/", {'content': 'أحدث'}, format='json')
        self.assertEqual([c['id'] for c in self.ali.get('/api/conversations/').data][:1], [d['id']])
        self.assertFalse(self.sara.get(f"/api/conversations/{d['id']}/").data['is_pinned'])  # التثبيت خاص بيه

        # تفاعل: سارة ❤️، علي ❤️، علي مرة ثانية = يشيل، وبعدها 👍 يبدل
        r = self.sara.post(f"/api/messages/{m['id']}/react/", {'emoji': '❤️'}, format='json').data
        self.assertEqual(r['reactions'], [{'emoji': '❤️', 'count': 1, 'user_ids': [self.sara.user['id']]}])
        self.ali.post(f"/api/messages/{m['id']}/react/", {'emoji': '❤️'}, format='json')
        r = self.ali.post(f"/api/messages/{m['id']}/react/", {'emoji': '❤️'}, format='json').data
        self.assertEqual(r['reactions'][0]['count'], 1)
        r = self.sara.post(f"/api/messages/{m['id']}/react/", {'emoji': '👍'}, format='json').data
        self.assertEqual([x['emoji'] for x in r['reactions']], ['👍'])
        self.assertEqual(self.omar.post(f"/api/messages/{m['id']}/react/", {'emoji': '❤️'}, format='json').status_code, 404)

        # نجمة: خاصة بكل شخص
        self.assertTrue(self.sara.post(f"/api/messages/{m['id']}/star/").data['starred'])
        self.assertEqual([x['id'] for x in self.sara.get(f"/api/starred/?conversation={d['id']}").data], [m['id']])
        self.assertEqual(self.ali.get('/api/starred/').data, [])
        self.sara.delete(f"/api/messages/{m['id']}/star/")
        self.assertEqual(self.sara.get('/api/starred/').data, [])

        # حذف المحادثة عندي: تختفي من عندي بس، وترجع إذا وصلت رسالة جديدة
        self.assertEqual(self.ali.post(f"/api/conversations/{d['id']}/clear/").status_code, 204)
        self.assertNotIn(d['id'], [c['id'] for c in self.ali.get('/api/conversations/').data])
        self.assertEqual(self.ali.get(f"/api/conversations/{d['id']}/messages/").data, [])
        self.assertEqual(len(self.sara.get(f"/api/conversations/{d['id']}/messages/").data), 1)
        self.sara.post(f"/api/conversations/{d['id']}/messages/", {'content': 'رجعت'}, format='json')
        back = next(c for c in self.ali.get('/api/conversations/').data if c['id'] == d['id'])
        self.assertEqual((back['last_message']['content'], back['unread_count']), ('رجعت', 1))
        self.assertEqual([x['content'] for x in self.ali.get(f"/api/conversations/{d['id']}/messages/").data], ['رجعت'])


@override_settings(MEDIA_ROOT=MEDIA, PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class ChannelTests(Base, TestCase):
    """القنوات: ينشئها وينشر فيها التدريسيون والإداريون فقط، والمشتركون يقرؤون ويتفاعلون."""

    def setUp(self):
        cache.clear()
        self.dr = self.register('dr_ali', 'د. علي', role='faculty')
        self.sara, self.omar = self.register('sara'), self.register('omar')

    def test_only_faculty_or_staff_create(self, _):
        r = self.sara.post('/api/channels/', {'title': 'قناتي'}, format='json')
        self.assertEqual(r.status_code, 403)
        r = self.dr.post('/api/channels/', {'title': 'إعلانات الحاسوب', 'description': 'للمرحلة الثالثة'}, format='json')
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual((r.data['kind'], r.data['my_role'], r.data['participants']), ('channel', 'admin', []))

    def test_subscribers_read_but_cannot_post(self, push):
        ch = self.dr.post('/api/channels/', {'title': 'إعلانات الحاسوب'}, format='json').data
        found = self.sara.get('/api/channels/?q=الحاسوب').data
        self.assertEqual([(c['title'], c['is_subscribed']) for c in found], [('إعلانات الحاسوب', False)])
        # غير المشترك لا يقرأ
        self.assertEqual(self.sara.get(f"/api/conversations/{ch['id']}/messages/").status_code, 404)
        self.assertEqual(self.sara.post(f"/api/channels/{ch['id']}/subscribe/").status_code, 201)
        self.sara.post('/api/push/subscribe/', {'endpoint': 'https://push.example.com/s', 'keys': {'p256dh': 'P', 'auth': 'A'}},
                       format='json')
        self.omar.post(f"/api/channels/{ch['id']}/subscribe/")
        self.assertEqual(self.sara.get('/api/channels/').data[0]['member_count'], 3)
        # المشترك لا ينشر
        url = f"/api/conversations/{ch['id']}/messages/"
        self.assertEqual(self.sara.post(url, {'content': 'مرحبا'}, format='json').status_code, 403)
        post = self.dr.post(url, {'content': 'المحاضرة غداً الساعة 9'}, format='json')
        self.assertEqual(post.status_code, 201)
        self.assertEqual(post.data['status'], 'sent')  # لا علامات قراءة في القناة
        msgs = self.sara.get(url).data
        self.assertEqual(msgs[-1]['content'], 'المحاضرة غداً الساعة 9')
        # الإشعار باسم القناة
        payloads = [c.args[1] for c in push.call_args_list]
        self.assertTrue(any('إعلانات الحاسوب' in p and 'المحاضرة غداً' in p for p in payloads))
        # التفاعل مسموح
        self.assertEqual(self.sara.post(f"/api/messages/{post.data['id']}/react/", {'emoji': '👍'}, format='json').status_code, 200)
        # المشترك يرى المشرفين فقط، والمشرف يرى الجميع
        self.assertEqual([m['user']['username'] for m in self.sara.get(f"/api/conversations/{ch['id']}/members/").data], ['dr_ali'])
        self.assertEqual(len(self.dr.get(f"/api/conversations/{ch['id']}/members/").data), 3)
        # المشتركون لا يصبحون «معارف» لبعضهم
        self.assertEqual(self.sara.get('/api/users/').data, [])
        # لا مكالمات في القناة (وإلا رنّ هاتف كل مشترك)
        self.assertEqual(self.sara.post('/api/calls/', {'conversation_id': ch['id']}, format='json').status_code, 400)
        # فلتر القنوات في القائمة
        self.assertEqual([c['id'] for c in self.sara.get('/api/conversations/?filter=channels').data], [ch['id']])
        self.assertEqual(self.sara.get('/api/conversations/?filter=groups').data, [])

    def test_admins_must_be_faculty_or_staff(self, _):
        ch = self.dr.post('/api/channels/', {'title': 'ق'}, format='json').data
        self.sara.post(f"/api/channels/{ch['id']}/subscribe/")
        staff = self.register('staff1', role='staff')
        staff.post(f"/api/channels/{ch['id']}/subscribe/")
        role = f"/api/conversations/{ch['id']}/members/"
        self.assertEqual(self.dr.patch(f"{role}{self.sara.user['id']}/", {'role': 'admin'}, format='json').status_code, 403)
        self.assertEqual(self.dr.patch(f"{role}{staff.user['id']}/", {'role': 'admin'}, format='json').status_code, 200)
        self.assertEqual(staff.post(f"/api/conversations/{ch['id']}/messages/", {'content': 'تنبيه'}, format='json').status_code, 201)
        # يغادر المشرفان: الطالبة لا ترث الإشراف
        self.dr.delete(f"/api/channels/{ch['id']}/subscribe/")
        staff.delete(f"/api/channels/{ch['id']}/subscribe/")
        self.assertEqual(self.sara.get(f"/api/conversations/{ch['id']}/").data['my_role'], 'member')
        self.assertEqual(self.sara.post(f"/api/conversations/{ch['id']}/messages/", {'content': 'x'}, format='json').status_code, 403)


class DeliveredTests(Base, TransactionTestCase):
    async def test_delivered_when_device_connects(self):
        from asgiref.sync import sync_to_async
        ali, sara = await sync_to_async(self.register)('ali'), await sync_to_async(self.register)('sara')
        d = await sync_to_async(open_chat)(ali, sara.user['id'])
        url = f"/api/conversations/{d.data['id']}/messages/"
        m = await sync_to_async(ali.post)(url, {'content': 'هلو'}, format='json')
        self.assertEqual(m.data['status'], 'sent')
        omar = await sync_to_async(self.register)('omar')  # مو من معارف سارة
        ali_ws = WebsocketCommunicator(application, f'/ws/presence/?token={ali.token}')
        omar_ws = WebsocketCommunicator(application, f'/ws/presence/?token={omar.token}')
        await ali_ws.connect()
        await omar_ws.connect()
        ws = WebsocketCommunicator(application, f'/ws/presence/?token={sara.token}')
        self.assertTrue((await ws.connect())[0])
        # "متصل" يوصل بس لعلي (يشاركها محادثة)، مو لعمر ولا لكل الجامعة
        event = await ali_ws.receive_json_from(timeout=3)
        while event.get('type') != 'presence':
            event = await ali_ws.receive_json_from(timeout=3)
        self.assertEqual((event['user_id'], event['is_online']), (sara.user['id'], True))
        self.assertTrue(await omar_ws.receive_nothing(timeout=0.5))
        await ali_ws.disconnect()
        await omar_ws.disconnect()
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


@override_settings(MEDIA_ROOT=MEDIA, PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class SecurityTests(Base, TestCase):
    """التشفير والهاش: اللي بقاعدة البيانات والقرص ما ينقرا، والروابط محمية."""

    def test_message_encrypted_at_rest(self, _):
        from django.db import connection
        ali, sara = self.register('ali'), self.register('sara')
        d = open_chat(ali, sara.user['id']).data
        m = ali.post(f"/api/conversations/{d['id']}/messages/", {'content': 'سر: https://x.iq'}, format='json').data
        self.assertEqual(m['content'], 'سر: https://x.iq')  # الـ API يرجعها مفهومة
        with connection.cursor() as c:
            c.execute('SELECT content, has_link FROM chat_message WHERE id = %s', [m['id']])
            raw, has_link = c.fetchone()
        self.assertTrue(raw.startswith('enc1:'))            # بقاعدة البيانات مشفرة
        self.assertNotIn('سر', raw)
        self.assertTrue(has_link)
        links = ali.get(f"/api/conversations/{d['id']}/media/?type=link").data
        self.assertEqual([x['id'] for x in links['results']], [m['id']])

    def test_file_encrypted_and_signed_url(self, _):
        from pathlib import Path

        from django.test import Client
        ali, sara = self.register('ali'), self.register('sara')
        d = open_chat(ali, sara.user['id']).data
        data = b'%PDF-1.4 ' + bytes(range(256)) * 700  # أكبر من قطعة وحدة
        up = SimpleUploadedFile('خطة.pdf', data, content_type='application/pdf')
        m = ali.post(f"/api/conversations/{d['id']}/messages/", {'file': up, 'kind': 'file'}, format='multipart').data
        url = m['file_url']
        path = url.split('?')[0].replace('/media/', '')
        on_disk = (Path(MEDIA) / path).read_bytes()
        self.assertTrue(on_disk.startswith(b'WASLENC1'))     # على القرص مشفر
        self.assertNotIn(b'%PDF', on_disk)
        c = Client()
        self.assertEqual(c.get(url.split('?')[0]).status_code, 403)             # بدون توقيع
        self.assertEqual(c.get(url.replace('s=', 's=0')).status_code, 403)       # توقيع مزور
        r = c.get(url)
        self.assertEqual(b''.join(r.streaming_content), data)                   # ينفك صح
        r = c.get(url, HTTP_RANGE='bytes=100-70099')                             # جزء (صوت/فيديو)
        self.assertEqual((r.status_code, r['Content-Range']), (206, f'bytes 100-70099/{len(data)}'))
        self.assertEqual(b''.join(r.streaming_content), data[100:70100])

    def test_password_argon2_and_hashed_tokens(self, _):
        from django.contrib.auth.models import User

        from accounts.models import AuthToken
        from accounts.tokens import hash_token
        ali = self.register('ali')
        self.assertTrue(User.objects.get(username='ali').password.startswith('argon2'))
        stored = AuthToken.objects.get(user__username='ali').key_hash
        self.assertNotEqual(stored, ali.token)                 # التوكن نفسه مو محفوظ
        self.assertEqual(stored, hash_token(ali.token))
        self.assertEqual(ali.get('/api/auth/me/').status_code, 200)
        self.assertEqual(ali.post('/api/auth/logout/').status_code, 204)
        self.assertEqual(ali.get('/api/auth/me/').status_code, 401)  # بعد الخروج التوكن ما يشتغل
