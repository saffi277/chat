from datetime import timedelta
from unittest import mock

from asgiref.sync import sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from chat.testing import open_chat
from config.asgi import application

from .models import Call


def register(username):
    r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123'}, format='json')
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
    c.user, c.token = r.data['user'], r.data['token']
    return c


@override_settings(PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class CallTests(TestCase):
    def setUp(self):
        self.ali, self.sara = register('ali'), register('sara')
        self.conv = open_chat(self.ali, self.sara.user['id']).data['id']

    def test_answered_call(self, _):
        c = self.ali.post('/api/calls/', {'conversation_id': self.conv, 'kind': 'video'}, format='json').data
        self.assertEqual(c['status'], 'ringing')
        self.assertTrue(c['ice_servers'])
        self.assertEqual(self.ali.post('/api/calls/', {'conversation_id': self.conv}, format='json').status_code, 400)
        self.assertEqual(self.sara.post(f"/api/calls/{c['id']}/answer/").data['status'], 'ongoing')
        Call.objects.filter(pk=c['id']).update(answered_at=timezone.now() - timedelta(seconds=75))
        self.assertEqual(self.sara.post(f"/api/calls/{c['id']}/end/").data['status'], 'ended')
        log = self.sara.get('/api/calls/').data[0]
        self.assertEqual((log['direction'], log['duration'], log['peer']['username']), ('incoming', 75, 'ali'))
        last = self.sara.get(f'/api/conversations/{self.conv}/messages/').data[-1]
        self.assertEqual((last['kind'], last['content']), ('call', 'مكالمة فيديو • 1:15'))

    def test_missed_and_declined(self, _):
        c = self.ali.post('/api/calls/', {'conversation_id': self.conv}, format='json').data
        self.sara.post(f"/api/calls/{c['id']}/decline/")
        self.assertEqual(self.sara.get('/api/calls/?filter=missed').data[0]['status'], 'declined')
        c2 = self.ali.post('/api/calls/', {'conversation_id': self.conv}, format='json').data
        Call.objects.filter(pk=c2['id']).update(created_at=timezone.now() - timedelta(minutes=2))
        log = {c['id']: c for c in self.sara.get('/api/calls/').data}
        self.assertEqual((log[c2['id']]['status'], log[c2['id']]['direction']), ('missed', 'missed'))
        outsider = register('omar')
        self.assertEqual(outsider.post(f"/api/calls/{c2['id']}/answer/").status_code, 404)

    def test_ringing_call_is_found_after_opening_from_a_notification(self, _):
        self.assertIsNone(self.sara.get('/api/calls/ringing/').data['call'])
        c = self.ali.post('/api/calls/', {'conversation_id': self.conv}, format='json').data
        self.assertEqual(self.sara.get('/api/calls/ringing/').data['call']['id'], c['id'])
        self.assertIsNone(self.ali.get('/api/calls/ringing/').data['call'])  # المتصل لا يرى مكالمته كواردة
        self.sara.post(f"/api/calls/{c['id']}/answer/")
        self.assertIsNone(self.sara.get('/api/calls/ringing/').data['call'])

    def test_upgrade_to_video(self, _):
        c = self.ali.post('/api/calls/', {'conversation_id': self.conv, 'kind': 'audio'}, format='json').data
        self.assertEqual(self.ali.post(f"/api/calls/{c['id']}/video/").status_code, 400)  # قبل الرد
        self.sara.post(f"/api/calls/{c['id']}/answer/")
        self.assertTrue(self.ali.post(f"/api/calls/{c['id']}/video/").data['ok'])
        self.assertEqual(Call.objects.get(pk=c['id']).kind, 'video')


class IceServerTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.delete('turn_servers')

    def test_stun_only_by_default(self):
        from .views import ice_servers
        with mock.patch.dict('os.environ', {}, clear=False):
            for k in ('CLOUDFLARE_TURN_KEY_ID', 'TURN_CREDENTIALS_URL', 'TURN_URLS'):
                __import__('os').environ.pop(k, None)
            servers = ice_servers()
        self.assertTrue(all(str(u).startswith('stun:') for s in servers for u in s['urls']))

    def test_turn_from_environment(self):
        from .views import ice_servers
        env = {'TURN_URLS': 'turn:turn.example.com:3478,turns:turn.example.com:5349', 'TURN_USERNAME': 'u', 'TURN_CREDENTIAL': 'p'}
        with mock.patch.dict('os.environ', env):
            turn = ice_servers()[-1]
        self.assertEqual((turn['urls'][0], turn['username'], turn['credential']), ('turn:turn.example.com:3478', 'u', 'p'))

    def test_cloudflare_turn_credentials(self):
        from .views import ice_servers
        reply = mock.MagicMock()
        reply.__enter__.return_value = __import__('io').BytesIO(b'{"iceServers": [{"urls": ["turn:turn.cloudflare.com:3478"], "username": "x", "credential": "y"}]}')
        env = {'CLOUDFLARE_TURN_KEY_ID': 'k', 'CLOUDFLARE_TURN_API_TOKEN': 't'}
        with mock.patch.dict('os.environ', env), mock.patch('urllib.request.urlopen', return_value=reply) as urlopen:
            turn = ice_servers()[-1]
        self.assertEqual(turn['username'], 'x')
        self.assertIn('/turn/keys/k/credentials/', urlopen.call_args.args[0].full_url)


class SignalingTests(TransactionTestCase):
    async def test_signal_relayed_only_within_call(self):
        ali, sara, omar = [await sync_to_async(register)(n) for n in ('ali', 'sara', 'omar')]
        conv = (await sync_to_async(open_chat)(ali, sara.user['id'])).data
        with mock.patch('notifications.push.webpush'):
            call = (await sync_to_async(ali.post)('/api/calls/', {'conversation_id': conv['id']}, format='json')).data
        a = WebsocketCommunicator(application, f'/ws/presence/?token={ali.token}')
        s = WebsocketCommunicator(application, f'/ws/presence/?token={sara.token}')
        await a.connect()
        await s.connect()
        # نفرغ أحداث الحضور
        while not await s.receive_nothing(timeout=0.3):
            await s.receive_json_from()
        await a.send_json_to({'type': 'call.signal', 'call_id': call['id'], 'to': sara.user['id'],
                              'data': {'sdp': 'offer-sdp'}})
        got = await s.receive_json_from()
        self.assertEqual((got['type'], got['from'], got['data']['sdp']), ('call.signal', ali.user['id'], 'offer-sdp'))
        # لشخص مو بالمكالمة: ما يوصل
        await a.send_json_to({'type': 'call.signal', 'call_id': call['id'], 'to': omar.user['id'], 'data': {}})
        await a.disconnect()
        await s.disconnect()
