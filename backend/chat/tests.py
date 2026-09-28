from channels.testing import WebsocketCommunicator
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from chat.testing import open_chat
from config.asgi import application


class ChatFlowTests(TransactionTestCase):
    def register(self, username):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123'}, format='json')
        self.assertEqual(r.status_code, 201)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        return client, r.data

    def test_full_http_flow(self):
        ali, ali_data = self.register('ali')
        sara, sara_data = self.register('sara')

        self.assertEqual(APIClient().get('/api/users/').status_code, 401)
        # لا أحد يرى حسابات الجامعة كلها: قبل الإضافة لا يعرف علي أحداً، ولا يستطيع مراسلة سارة
        self.assertEqual(ali.get('/api/users/').data, [])
        self.assertEqual(ali.post('/api/conversations/', {'user_id': sara_data['user']['id']}, format='json').status_code, 404)

        conv = open_chat(ali, sara_data['user']['id'])
        users = ali.get('/api/users/').data
        self.assertEqual([(u['username'], u['is_contact']) for u in users], [('sara', True)])
        self.assertEqual(conv.status_code, 201)
        # سارة لم تضفه، لكنه أضافها وراسلها فتستطيع الرد
        again = sara.post('/api/conversations/', {'user_id': ali_data['user']['id']}, format='json')
        self.assertEqual(again.data['id'], conv.data['id'])

        cid = conv.data['id']
        r = ali.post(f'/api/conversations/{cid}/messages/', {'content': 'هلو'}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(sara.get('/api/conversations/').data[0]['unread_count'], 1)
        self.assertEqual(sara.patch(f'/api/conversations/{cid}/read/').data['updated'], 1)
        self.assertTrue(sara.get(f'/api/conversations/{cid}/messages/').data[0]['is_read'])

        outsider, _ = self.register('omar')
        self.assertEqual(outsider.get(f'/api/conversations/{cid}/messages/').status_code, 404)

    async def test_websocket_message(self):
        from asgiref.sync import sync_to_async
        (ali, a), (sara, s) = await sync_to_async(self.register)('ali'), await sync_to_async(self.register)('sara')
        conv = await sync_to_async(open_chat)(ali, s['user']['id'])
        path = f"/ws/chat/{conv.data['id']}/?token="

        c1 = WebsocketCommunicator(application, path + a['token'])
        c2 = WebsocketCommunicator(application, path + s['token'])
        self.assertTrue((await c1.connect())[0])
        self.assertTrue((await c2.connect())[0])
        await c1.send_json_to({'type': 'message', 'content': 'مرحبا'})
        got = await c2.receive_json_from()
        self.assertEqual(got['message']['content'], 'مرحبا')
        await c1.disconnect()
        await c2.disconnect()

        bad = WebsocketCommunicator(application, path + 'wrong')
        self.assertFalse((await bad.connect())[0])
