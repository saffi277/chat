from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

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
        cid = ali.post('/api/conversations/', {'user_id': s['id']}, format='json').data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'هلو سارة'}, format='json')
        self.assertEqual(webpush.call_count, 1)
        info, payload = webpush.call_args.args
        self.assertEqual(info['endpoint'], SUB['endpoint'])
        self.assertIn('هلو سارة', payload)
        self.assertIn(f'/chat?c={cid}', payload)

    @mock.patch('notifications.push.webpush')
    def test_dead_subscription_is_removed(self, webpush):
        from pywebpush import WebPushException
        webpush.side_effect = WebPushException('gone', response=mock.Mock(status_code=410))
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        cid = ali.post('/api/conversations/', {'user_id': s['id']}, format='json').data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertEqual(PushSubscription.objects.count(), 0)

    @mock.patch('notifications.push.webpush')
    def test_hide_preview_hides_sender_and_text(self, webpush):
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        sara.post('/api/push/subscribe/', SUB, format='json')
        self.assertTrue(sara.patch('/api/auth/me/', {'hide_preview': True}, format='json').data['hide_preview'])
        cid = ali.post('/api/conversations/', {'user_id': s['id']}, format='json').data['id']
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
        cid = ali.post('/api/conversations/', {'user_id': s['id']}, format='json').data['id']
        ali.post(f'/api/conversations/{cid}/messages/', {'content': 'hi'}, format='json')
        self.assertIn('New message', webpush.call_args.args[1])
