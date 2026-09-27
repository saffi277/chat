from datetime import timedelta
from unittest import mock

from asgiref.sync import sync_to_async
from channels.testing import WebsocketCommunicator
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

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
        self.conv = self.ali.post('/api/conversations/', {'user_id': self.sara.user['id']}, format='json').data['id']

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


class SignalingTests(TransactionTestCase):
    async def test_signal_relayed_only_within_call(self):
        ali, sara, omar = [await sync_to_async(register)(n) for n in ('ali', 'sara', 'omar')]
        conv = (await sync_to_async(ali.post)('/api/conversations/', {'user_id': sara.user['id']}, format='json')).data
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
