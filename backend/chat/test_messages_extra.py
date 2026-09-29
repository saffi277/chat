"""إعادة التوجيه، والبحث، والتثبيت، والإشارة بـ @، والاستطلاعات، ومعاينة الروابط، ومشاهدات القناة."""
import io
import shutil
import tempfile
from unittest import mock

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from chat.testing import befriend, open_chat

MEDIA = tempfile.mkdtemp()


def register(username, role='student'):
    r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123'}, format='json')
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
    c.user, c.token = r.data['user'], r.data['token']
    if role != 'student':
        from accounts.models import Profile
        Profile.objects.filter(user_id=c.user['id']).update(role=role)
    return c


@override_settings(MEDIA_ROOT=MEDIA, PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class MessageFeatureTests(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(MEDIA, ignore_errors=True)

    def setUp(self):
        cache.clear()
        self.ali, self.sara, self.omar = register('ali'), register('sara'), register('omar')
        self.dm = open_chat(self.ali, self.sara.user['id']).data['id']
        befriend(self.ali, self.omar.user['id'])
        self.group = self.ali.post('/api/conversations/groups/', {'title': 'الشعبة', 'member_ids': [self.sara.user['id'], self.omar.user['id']]},
                                   format='json').data['id']

    def send(self, client, conv, **data):
        return client.post(f'/api/conversations/{conv}/messages/', data, format='json')

    def test_forward_text_and_file(self, _):
        t = self.send(self.ali, self.dm, content='ملخص المحاضرة الثالثة').data
        buf = io.BytesIO()
        Image.new('RGB', (30, 20), 'green').save(buf, 'PNG')
        img = self.ali.post(f'/api/conversations/{self.dm}/messages/', {'file': SimpleUploadedFile('s.png', buf.getvalue(), content_type='image/png')},
                            format='multipart').data
        r = self.ali.post('/api/messages/forward/', {'message_ids': [t['id'], img['id']], 'conversation_ids': [self.group]}, format='json')
        self.assertEqual((r.status_code, r.data['sent']), (201, 2))
        msgs = self.omar.get(f'/api/conversations/{self.group}/messages/').data[-2:]
        self.assertEqual([(m['content'], m['forwarded']) for m in msgs], [('ملخص المحاضرة الثالثة', True), ('', True)])
        self.assertEqual((msgs[1]['kind'], msgs[1]['width'], msgs[1]['height']), ('image', 30, 20))
        self.assertNotEqual(msgs[1]['file_url'].split('?')[0], img['file_url'].split('?')[0])  # نسخة مستقلة
        self.assertEqual(self.client.get(msgs[1]['file_url']).status_code, 200)  # تُفك وتُعرض
        # حذف الأصل لا يمس النسخة
        self.ali.delete(f"/api/messages/{img['id']}/")
        self.assertEqual(self.client.get(msgs[1]['file_url']).status_code, 200)
        # لا توجيه من محادثة لست فيها
        self.assertEqual(self.omar.post('/api/messages/forward/', {'message_ids': [t['id']], 'conversation_ids': [self.group]},
                                        format='json').status_code, 404)

    def test_search_decrypts_and_respects_membership(self, _):
        self.send(self.ali, self.dm, content='موعد امتحان البرمجة يوم الأحد')
        self.send(self.ali, self.group, content='امتحان الرياضيات مؤجل')
        self.send(self.ali, self.group, content='شكراً')
        r = self.sara.get('/api/search/?q=امتحان').data
        self.assertEqual(len(r), 2)
        self.assertEqual(r[0]['message']['content'], 'امتحان الرياضيات مؤجل')  # الأحدث أولاً
        self.assertEqual(r[0]['conversation']['title'], 'الشعبة')
        self.assertEqual(len(self.sara.get(f'/api/search/?q=امتحان&conversation={self.dm}').data), 1)
        self.assertEqual(len(self.omar.get('/api/search/?q=امتحان').data), 1)  # ليس في المحادثة الثنائية
        self.assertEqual(self.sara.get('/api/search/?q=ا').data, [])  # حرف واحد لا يكفي
        self.sara.post(f'/api/conversations/{self.dm}/clear/')
        self.assertEqual(len(self.sara.get('/api/search/?q=امتحان').data), 1)  # حذفتُها عندي

    def test_pin_message(self, _):
        m = self.send(self.sara, self.group, content='رابط المحاضرات').data
        self.assertEqual(self.sara.post(f"/api/messages/{m['id']}/pin/").status_code, 403)  # الأعضاء لا يثبّتون افتراضياً
        self.assertEqual(self.ali.post(f"/api/messages/{m['id']}/pin/").status_code, 200)
        conv = self.omar.get(f'/api/conversations/{self.group}/').data
        self.assertEqual((conv['pinned_message']['id'], conv['pinned_message']['preview']), (m['id'], 'رابط المحاضرات'))
        listed = next(c for c in self.omar.get('/api/conversations/').data if c['id'] == self.group)
        self.assertEqual(listed['pinned_message']['id'], m['id'])
        self.ali.delete(f"/api/messages/{m['id']}/pin/")
        self.assertIsNone(self.omar.get(f'/api/conversations/{self.group}/').data['pinned_message'])
        d = self.send(self.sara, self.dm, content='مهم').data
        self.assertEqual(self.sara.post(f"/api/messages/{d['id']}/pin/").status_code, 200)  # الثنائية: أي طرف

    def test_mention_notifies_even_when_muted(self, push):
        for c in (self.sara, self.omar):
            c.post('/api/push/subscribe/', {'endpoint': f"https://push.example.com/{c.user['id']}", 'keys': {'p256dh': 'k', 'auth': 'a'}}, format='json')
            c.patch(f'/api/conversations/{self.group}/', {'is_muted': True}, format='json')
        self.send(self.ali, self.group, content='@sara هل أرسلتِ الواجب؟')
        endpoints = [call.args[0]['endpoint'] for call in push.call_args_list]
        self.assertEqual(endpoints, [f"https://push.example.com/{self.sara.user['id']}"])  # عمر مكتوم ولم يُذكر

    def test_poll(self, _):
        r = self.send(self.ali, self.group, kind='poll', content='موعد المراجعة؟', options=['الأحد', 'الأحد', ' '])
        self.assertEqual(r.status_code, 400)  # خياران مختلفان على الأقل (المكرر والفارغ لا يُحسبان)
        p = self.send(self.ali, self.group, kind='poll', content='موعد المراجعة؟', options=['الأحد', 'الاثنين', 'الثلاثاء']).data
        self.assertEqual((p['kind'], p['poll']['multiple'], len(p['poll']['options'])), ('poll', False, 3))
        o = [x['id'] for x in p['poll']['options']]
        v = self.sara.post(f"/api/messages/{p['id']}/vote/", {'option_ids': [o[1]]}, format='json').data
        self.assertEqual((v['poll']['total_voters'], v['poll']['options'][1]['voter_ids']), (1, [self.sara.user['id']]))
        self.assertEqual(self.sara.post(f"/api/messages/{p['id']}/vote/", {'option_ids': o[:2]}, format='json').status_code, 400)
        self.omar.post(f"/api/messages/{p['id']}/vote/", {'option_ids': [o[1]]}, format='json')
        v = self.sara.post(f"/api/messages/{p['id']}/vote/", {'option_ids': [o[0]]}, format='json').data  # تغيير الصوت
        self.assertEqual([x['votes'] for x in v['poll']['options']], [1, 1, 0])
        last = next(c for c in self.omar.get('/api/conversations/').data if c['id'] == self.group)['last_message']
        self.assertEqual((last['kind'], last['content']), ('poll', 'موعد المراجعة؟'))
        self.assertEqual(register('zaid').post(f"/api/messages/{p['id']}/vote/", {'option_ids': [o[0]]}, format='json').status_code, 404)

    def test_channel_views_for_admin(self, _):
        dr = register('dr', role='faculty')
        ch = dr.post('/api/channels/', {'title': 'إعلانات'}, format='json').data['id']
        for c in (self.sara, self.omar):
            c.post(f'/api/channels/{ch}/subscribe/')
        post = self.send(dr, ch, content='الامتحان غداً').data
        self.sara.patch(f'/api/conversations/{ch}/read/')
        mine = next(m for m in dr.get(f'/api/conversations/{ch}/messages/').data if m['id'] == post['id'])
        self.assertEqual(mine['views'], 1)
        self.omar.patch(f'/api/conversations/{ch}/read/')
        self.assertEqual(next(m for m in dr.get(f'/api/conversations/{ch}/messages/').data if m['id'] == post['id'])['views'], 2)
        self.assertNotIn('views', self.sara.get(f'/api/conversations/{ch}/messages/').data[-1])  # للمشرف فقط


class FolderTests(TestCase):
    def test_folders(self):
        ali, sara = register('ali'), register('sara')
        dm = open_chat(ali, sara.user['id']).data['id']
        other = open_chat(sara, register('omar').user['id']).data['id']  # ليست محادثتي
        f = ali.post('/api/folders/', {'name': 'الدراسة', 'conversation_ids': [dm, other]}, format='json').data
        self.assertEqual((f['name'], f['conversation_ids']), ('الدراسة', [dm]))
        self.assertEqual(ali.post('/api/folders/', {'name': ' '}, format='json').status_code, 400)
        self.assertEqual(sara.get('/api/folders/').data, [])  # مجلداتي لي وحدي
        self.assertEqual(sara.patch(f"/api/folders/{f['id']}/", {'name': 'x'}, format='json').status_code, 404)
        r = ali.patch(f"/api/folders/{f['id']}/", {'name': 'المواد', 'conversation_ids': []}, format='json').data
        self.assertEqual((r['name'], r['conversation_ids']), ('المواد', []))
        ali.delete(f"/api/folders/{f['id']}/")
        self.assertEqual(ali.get('/api/folders/').data, [])


class LinkPreviewTests(TestCase):
    def setUp(self):
        cache.clear()
        self.c = register('ali')

    def test_blocks_internal_addresses(self):
        from chat.features import fetch_preview
        for url in ('http://127.0.0.1/', 'http://localhost:8000/admin/', 'http://169.254.169.254/latest/meta-data/',
                    'http://10.0.0.5/', 'file:///etc/passwd', 'http://example.com:22/'):
            self.assertIsNone(fetch_preview(url), url)
        self.assertIsNone(self.c.get('/api/link-preview/?url=http://127.0.0.1:8000/').data['preview'])

    def test_parses_open_graph(self):
        from chat import features
        page = ('<html><head><title>غير مستعمل</title><meta property="og:title" content="كلية الأسباط الجامعة">'
                '<meta property="og:description" content="الموقع الرسمي"><meta property="og:image" content="/logo.png">'
                '</head></html>').encode()
        resp = mock.MagicMock()
        resp.headers.get.return_value = 'text/html; charset=utf-8'
        resp.headers.get_content_charset.return_value = 'utf-8'
        resp.read.return_value = page
        resp.__enter__.return_value = resp
        with mock.patch.object(features, '_public_host', return_value=True), \
                mock.patch('urllib.request.OpenerDirector.open', return_value=resp):
            data = self.c.get('/api/link-preview/?url=https://asbat.edu.iq/').data['preview']
        self.assertEqual((data['title'], data['description'], data['image'], data['site']),
                         ('كلية الأسباط الجامعة', 'الموقع الرسمي', 'https://asbat.edu.iq/logo.png', 'asbat.edu.iq'))
