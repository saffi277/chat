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

    async def test_heartbeat_ping_gets_pong_on_both_sockets(self):
        """نبض الواجهة: تكتشف به الاتصال الميت (الهاتف في الخلفية) فتعيده فوراً بدل أن تفوتها الرسائل والمكالمات."""
        from asgiref.sync import sync_to_async
        (ali, a), (sara, s) = await sync_to_async(self.register)('ali'), await sync_to_async(self.register)('sara')
        conv = await sync_to_async(open_chat)(ali, s['user']['id'])
        for path in (f"/ws/chat/{conv.data['id']}/", '/ws/presence/'):
            ws = WebsocketCommunicator(application, f"{path}?token={a['token']}")
            self.assertTrue((await ws.connect())[0])
            while not await ws.receive_nothing(timeout=0.2):
                await ws.receive_json_from()
            await ws.send_json_to({'type': 'ping'})
            self.assertEqual(await ws.receive_json_from(timeout=2), {'type': 'pong'})
            await ws.disconnect()

    async def test_websocket_rate_limit(self):
        """إغراق المحادثة عبر WebSocket: أول 20 رسالة تُحفظ، والباقي يُرفض بـ rate_limited."""
        from asgiref.sync import sync_to_async

        from chat.models import Message
        (ali, a), (sara, s) = await sync_to_async(self.register)('ali'), await sync_to_async(self.register)('sara')
        conv = await sync_to_async(open_chat)(ali, s['user']['id'])
        ws = WebsocketCommunicator(application, f"/ws/chat/{conv.data['id']}/?token={a['token']}")
        self.assertTrue((await ws.connect())[0])
        for i in range(25):
            await ws.send_json_to({'type': 'message', 'content': f'رسالة {i}'})
        errors = 0
        for _ in range(25 + 5):
            event = await ws.receive_json_from(timeout=3)
            errors += event.get('type') == 'error'
            if errors == 5:
                break
        await ws.disconnect()
        self.assertEqual(errors, 5)
        self.assertEqual(await sync_to_async(Message.objects.filter(conversation_id=conv.data['id']).count)(), 20)

    async def test_websocket_client_id_is_echoed_and_resend_is_not_duplicated(self):
        """
        الرسالة تظهر عند المرسل فوراً «قيد الإرسال» بمعرّف من جهازه (client_id)، فيعود المعرّف مع الرسالة ليطابقها.
        وإن أعاد إرسالها (انقطع الاتصال قبل أن يصله الرد) لا تتكرر، ويصله ردّها وحده.
        """
        from asgiref.sync import sync_to_async

        from chat.models import Message
        (ali, a), (sara, s) = await sync_to_async(self.register)('ali'), await sync_to_async(self.register)('sara')
        conv = await sync_to_async(open_chat)(ali, s['user']['id'])
        path = f"/ws/chat/{conv.data['id']}/?token="
        c1 = WebsocketCommunicator(application, path + a['token'])
        c2 = WebsocketCommunicator(application, path + s['token'])
        self.assertTrue((await c1.connect())[0])
        self.assertTrue((await c2.connect())[0])
        await c1.send_json_to({'type': 'message', 'content': 'مرحبا', 'client_id': 'abc12345-xyz'})
        mine = await c1.receive_json_from()
        self.assertEqual((mine['type'], mine['message']['client_id']), ('message', 'abc12345-xyz'))
        self.assertEqual((await c2.receive_json_from())['message']['content'], 'مرحبا')
        while not await c1.receive_nothing(timeout=0.2):  # «وصلت» وغيرها
            await c1.receive_json_from()
        while not await c2.receive_nothing(timeout=0.2):
            await c2.receive_json_from()
        # إعادة الإرسال: تصل للمرسل وحده، ولا تُحفظ مرتين
        await c1.send_json_to({'type': 'message', 'content': 'مرحبا', 'client_id': 'abc12345-xyz'})
        again = await c1.receive_json_from()
        self.assertEqual((again['type'], again['message']['id']), ('message', mine['message']['id']))
        self.assertTrue(await c2.receive_nothing(timeout=0.3))
        count = sync_to_async(Message.objects.filter(conversation_id=conv.data['id'], client_id='abc12345-xyz').count)
        self.assertEqual(await count(), 1)
        # معرّف غير صالح يُتجاهل (والرسالة تُرسل عادية)
        await c1.send_json_to({'type': 'message', 'content': 'ثانية', 'client_id': 'bad id!'})
        self.assertEqual((await c1.receive_json_from())['message']['client_id'], '')
        await c1.disconnect()
        await c2.disconnect()

    def test_http_client_id_resend_is_not_duplicated(self):
        ali, _ = self.register('ali')
        sara, s = self.register('sara')
        cid = open_chat(ali, s['user']['id']).data['id']
        url = f'/api/conversations/{cid}/messages/'
        first = ali.post(url, {'content': 'هلو', 'client_id': 'cid-00000001'}, format='json')
        self.assertEqual((first.status_code, first.data['client_id']), (201, 'cid-00000001'))
        again = ali.post(url, {'content': 'هلو', 'client_id': 'cid-00000001'}, format='json')
        self.assertEqual((again.status_code, again.data['id']), (200, first.data['id']))
        self.assertEqual(len(ali.get(url).data), 1)
        # معرّف شخص آخر بالقيمة نفسها لا يتعارض (المعرّف فريد لكل مرسل)
        self.assertEqual(sara.post(url, {'content': 'أهلاً', 'client_id': 'cid-00000001'}, format='json').status_code, 201)
