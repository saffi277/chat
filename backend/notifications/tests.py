from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from chat.testing import open_chat

from .models import PushSubscription

SUB = {'endpoint': 'https://push.example.com/abc', 'keys': {'p256dh': 'BPUB', 'auth': 'AUTH'}}


@override_settings(PUSH_RUN_INLINE=True)
class PushTests(TestCase):
    def register(self, username):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123'}, format='json')
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        return client, r.data['user']

    def test_public_key(self):
        key = APIClient().get('/api/push/key/').data['public_key']
        self.assertGreater(len(key), 80)

    def test_subscribe_and_unsubscribe(self):
        ali, _ = self.register('ali')
        self.assertEqual(APIClient().post('/api/push/subscribe/', SUB, format='json').status_code, 401)
        self.assertEqual(ali.post('/api/push/subscribe/', SUB, format='json').status_code, 201)
        self.assertEqual(ali.post('/api/push/subscribe/', SUB, format='json').status_code, 201)  # no duplicate
        self.assertEqual(PushSubscription.objects.count(), 1)
        ali.delete('/api/push/subscribe/', {'endpoint': SUB['endpoint']}, format='json')
        self.assertEqual(PushSubscription.objects.count(), 0)

    @mock.patch('notifications.push.webpush')
    def test_new_message_notifies_only_the_other_person(self, webpush):
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        ali.post('/api/push/subscribe/', {**SUB, 'endpoint': 'https://push.example.com/ali'}, format='json')
        sara.post('/api/push/subscribe/', SUB, format='json')
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'هلو سارة'}, format='json')
        self.assertEqual(webpush.call_count, 1)
        info, payload = webpush.call_args.args
        self.assertEqual(info['endpoint'], SUB['endpoint'])
        self.assertIn('هلو سارة', payload)
        self.assertIn(f'/chat?c={cid}', payload)

    @mock.patch('notifications.push.webpush')
    def test_push_has_a_timeout_and_reuses_the_connection(self, webpush):
        # بدون مهلة: خدمة إشعارات لا ترد كانت توقف العامل للأبد ويتأخر كل إشعار بعدها
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'a'}, format='json')
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'b'}, format='json')
        first, second = webpush.call_args_list
        self.assertEqual(first.kwargs['timeout'], 10)
        self.assertIs(first.kwargs['requests_session'], second.kwargs['requests_session'])

    @override_settings(PUSH_RUN_INLINE=False)
    @mock.patch('notifications.push.webpush')
    def test_devices_are_notified_in_parallel(self, webpush):
        # جهاز بطيء الرد لا يؤخر الأجهزة الأخرى: كل جهاز في مهمة مستقلة
        import threading
        release, started = threading.Event(), []
        def slow(info, *a, **k):
            started.append(info['endpoint'])
            if info['endpoint'].endswith('/slow'):
                release.wait(5)
        webpush.side_effect = slow
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        for end in ('slow', 'fast'):
            sara.post('/api/push/subscribe/', {**SUB, 'endpoint': f'https://push.example.com/{end}'}, format='json')
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        import time
        for _ in range(50):
            if len(started) == 2:
                break
            time.sleep(0.05)
        release.set()
        self.assertEqual(sorted(started), ['https://push.example.com/fast', 'https://push.example.com/slow'])

    @mock.patch('notifications.push.webpush')
    def test_dead_subscription_is_removed(self, webpush):
        from pywebpush import WebPushException
        webpush.side_effect = WebPushException('gone', response=mock.Mock(status_code=410))
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(PushSubscription.objects.count(), 0)

    @mock.patch('notifications.push.webpush')
    def test_subscription_made_with_another_server_key_is_removed(self, webpush):
        # اشتراك من خادم سابق (مفاتيح VAPID مختلفة): Apple ترفضه دائماً، فلا فائدة من إبقائه
        from pywebpush import WebPushException
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', {**SUB, 'endpoint': 'https://web.push.apple.com/old'}, format='json')
        webpush.side_effect = WebPushException('bad', response=mock.Mock(status_code=403, text='{"reason":"VapidPkHashMismatch"}'))
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(PushSubscription.objects.count(), 0)
        # أما رفض التوقيع لسبب آخر (BadJwtToken) فخلل في الخادم لا في الاشتراك: يبقى
        sara.post('/api/push/subscribe/', SUB, format='json')
        webpush.side_effect = WebPushException('bad', response=mock.Mock(status_code=403, text='{"reason":"BadJwtToken"}'))
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(PushSubscription.objects.count(), 1)

    @mock.patch('notifications.push.webpush')
    def test_hide_preview_hides_sender_and_text(self, webpush):
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        self.assertTrue(sara.patch('/api/auth/me/', {'hide_preview': True}, format='json').data['hide_preview'])
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'سر خطير'}, format='json')
        _, payload = webpush.call_args.args
        self.assertNotIn('سر خطير', payload)
        self.assertNotIn('ali', payload)
        self.assertIn('رسالة جديدة', payload)
        self.assertIn(f'/chat?c={cid}', payload)

    @mock.patch('notifications.push.webpush')
    def test_push_uses_each_recipients_language(self, webpush):
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        self.assertEqual(sara.patch('/api/auth/me/', {'language': 'en', 'hide_preview': True}, format='json').data['language'], 'en')
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertIn('New message', webpush.call_args.args[1])

    @mock.patch('notifications.push.webpush')
    def test_vapid_contact_is_accepted_by_apple_and_push_is_urgent(self, webpush):
        # خدمة Apple ترفض sub بنطاق وهمي (.local / localhost) فلا يصل أي إشعار إلى الآيفون
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        cid = open_chat(ali, s['id']).data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        kwargs = webpush.call_args.kwargs
        contact = kwargs['vapid_claims']['sub']
        self.assertTrue(contact.startswith(('mailto:', 'https://')))
        self.assertNotRegex(contact, r'\.local\b|localhost')
        self.assertEqual(kwargs['headers'], {'Urgency': 'high'})

    def real_subscription(self, client):
        # اشتراك بمفاتيح حقيقية حتى يمر التشفير والتوقيع الحقيقيان (لا نحاكي إلا طلب الشبكة)
        import base64
        import os

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        b64 = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b'=').decode()  # noqa: E731
        public = ec.generate_private_key(ec.SECP256R1()).public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        client.post('/api/push/subscribe/', {'endpoint': 'https://web.push.apple.com/real',
                                             'keys': {'p256dh': b64(public), 'auth': b64(os.urandom(16))}}, format='json')

    @mock.patch('requests.Session.post')
    def test_real_signing_with_the_default_contact(self, post):
        # كان العنوان الافتراضي https://github.com/saffi277/chat، ومكتبة التوقيع ترفض الرابط ذا المسار:
        # فلا يُرسل أي إشعار على الخادم (Docker) دون أن يظهر أي خطأ
        post.return_value = mock.Mock(status_code=201)
        ali, _ = self.register('ali')
        self.real_subscription(ali)
        results = ali.post('/api/push/test/').data['results']
        self.assertEqual((results[0]['ok'], results[0]['status']), (True, 201), results)
        import base64
        import json
        token = post.call_args.kwargs['headers']['authorization'].split()[-1]
        claims = json.loads(base64.urlsafe_b64decode(token.split('.')[1] + '=='))
        self.assertEqual((claims['sub'], claims['aud']), ('https://github.com', 'https://web.push.apple.com'))

    def test_contact_url_is_reduced_to_its_origin(self):
        from config.settings import _vapid_contact
        self.assertEqual(_vapid_contact('https://github.com/saffi277/chat'), 'https://github.com')
        self.assertEqual(_vapid_contact('https://chat.asbat.edu.iq/'), 'https://chat.asbat.edu.iq')
        self.assertEqual(_vapid_contact('mailto:it@asbat.edu.iq'), 'mailto:it@asbat.edu.iq')

    @mock.patch('requests.Session.post')
    def test_signing_error_is_reported_not_swallowed(self, post):
        ali, _ = self.register('ali')
        self.real_subscription(ali)
        with override_settings(VAPID_CONTACT='https://github.com/saffi277/chat'), self.assertLogs('notifications', 'ERROR'):
            results = ali.post('/api/push/test/').data['results']
        self.assertFalse(results[0]['ok'])
        self.assertIn('VapidException', results[0]['reason'])
        post.assert_not_called()

    @mock.patch('notifications.push.webpush')
    def test_test_endpoint_reports_each_device(self, webpush):
        from pywebpush import WebPushException
        ali, _ = self.register('ali')
        ali.post('/api/push/subscribe/', {**SUB, 'endpoint': 'https://web.push.apple.com/abc'}, format='json')
        webpush.side_effect = WebPushException('bad', response=mock.Mock(status_code=403, text='{"reason":"BadJwtToken"}'))
        r = ali.post('/api/push/test/').data['results']
        self.assertEqual((r[0]['ok'], r[0]['host'], r[0]['status']), (False, 'web.push.apple.com', 403))
        self.assertIn('BadJwtToken', r[0]['reason'])
        webpush.side_effect = None
        self.assertTrue(ali.post('/api/push/test/').data['results'][0]['ok'])
