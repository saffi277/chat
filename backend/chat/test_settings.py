"""إعدادات المحادثة: الكتم لمدة، والخلفية، والرسائل المختفية، وإعدادات المجموعة، ورابط الدعوة، والرسائل المجدولة."""
from datetime import timedelta
from unittest import mock

from channels.testing import WebsocketCommunicator
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from chat import worker
from chat.models import Membership, Message, ScheduledMessage
from chat.testing import befriend, open_chat
from config.asgi import application


class Base:
    def register(self, username, display=''):
        r = APIClient().post('/api/auth/register/', {'username': username, 'password': 'secret123',
                                                     'display_name': display or username}, format='json')
        c = APIClient()
        c.credentials(HTTP_AUTHORIZATION='Token ' + r.data['token'])
        c.user, c.token = r.data['user'], r.data['token']
        return c

    def subscribe_push(self, client):
        client.post('/api/push/subscribe/', {'endpoint': f"https://push.example.com/{client.user['id']}",
                                             'keys': {'p256dh': 'k', 'auth': 'a'}}, format='json')

    def group(self, admin, *members):
        befriend(admin, *[m.user['id'] for m in members])
        return admin.post('/api/conversations/groups/', {'title': 'مجموعة', 'member_ids': [m.user['id'] for m in members]},
                          format='json').data


@override_settings(PUSH_RUN_INLINE=True)
@mock.patch('notifications.push.webpush')
class ConversationSettingsTests(Base, TestCase):
    def setUp(self):
        cache.clear()
        self.ali, self.sara, self.omar = self.register('ali'), self.register('sara'), self.register('omar')

    def test_mute_for_a_while_then_notifications_return(self, push):
        self.subscribe_push(self.sara)
        d = open_chat(self.ali, self.sara.user['id']).data
        url = f"/api/conversations/{d['id']}/"
        r = self.sara.patch(url, {'is_muted': True, 'mute_hours': 8}, format='json')
        self.assertTrue(r.data['is_muted'])
        until = timezone.datetime.fromisoformat(r.data['muted_until'])
        self.assertAlmostEqual((until - timezone.now()).total_seconds(), 8 * 3600, delta=60)
        self.ali.post(f"{url}messages/", {'content': 'هل أنتِ هنا؟'}, format='json')
        self.assertEqual(push.call_count, 0)  # مكتومة: لا إشعار
        # انتهت المدة: يعود الإشعار وحده دون أن تفعل شيئاً
        Membership.objects.filter(user_id=self.sara.user['id'], conversation_id=d['id']).update(
            muted_until=timezone.now() - timedelta(minutes=1))
        self.assertFalse(self.sara.get(url).data['is_muted'])
        self.ali.post(f"{url}messages/", {'content': 'مرحباً'}, format='json')
        self.assertEqual(push.call_count, 1)
        # كتم دائم، ثم إلغاؤه
        r = self.sara.patch(url, {'is_muted': True}, format='json')
        self.assertEqual((r.data['is_muted'], r.data['muted_until']), (True, None))
        self.assertFalse(self.sara.patch(url, {'is_muted': False}, format='json').data['is_muted'])
        self.assertEqual(self.sara.patch(url, {'is_muted': True, 'mute_hours': -3}, format='json').status_code, 400)

    def test_silent_message_has_no_notification(self, push):
        self.subscribe_push(self.sara)
        d = open_chat(self.ali, self.sara.user['id']).data
        r = self.ali.post(f"/api/conversations/{d['id']}/messages/", {'content': 'بهدوء', 'silent': True}, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertEqual(push.call_count, 0)
        self.ali.post(f"/api/conversations/{d['id']}/messages/", {'content': 'عادية'}, format='json')
        self.assertEqual(push.call_count, 1)

    def test_wallpaper_per_chat_is_mine_only(self, push):
        d = open_chat(self.ali, self.sara.user['id']).data
        url = f"/api/conversations/{d['id']}/"
        self.assertEqual(self.ali.patch(url, {'wallpaper': 'dots'}, format='json').data['wallpaper'], 'dots')
        self.assertEqual(self.sara.get(url).data['wallpaper'], '')  # لا تتغير عند الطرف الآخر
        self.assertEqual(self.ali.patch(url, {'wallpaper': 'nope'}, format='json').status_code, 400)
        self.assertEqual(self.ali.patch(url, {'wallpaper': ''}, format='json').data['wallpaper'], '')

    def test_disappearing_messages(self, push):
        d = open_chat(self.ali, self.sara.user['id']).data
        url = f"/api/conversations/{d['id']}/"
        self.ali.post(f"{url}messages/", {'content': 'قبل التفعيل'}, format='json')
        r = self.sara.patch(url, {'disappear_after': 86400}, format='json')  # أي من الطرفين
        self.assertEqual(r.data['disappear_after'], 86400)
        msgs = self.ali.get(f"{url}messages/").data
        self.assertEqual(msgs[-1]['kind'], 'system')
        self.assertIn('فعّل الرسائل المختفية: 24 ساعة', msgs[-1]['content'])
        m = self.ali.post(f"{url}messages/", {'content': 'ستختفي'}, format='json').data
        self.assertIsNotNone(m['expires_at'])
        self.assertIsNone(msgs[0]['expires_at'])  # القديمة لا تتأثر
        # حان وقتها: العامل يحذفها نهائياً
        Message.objects.filter(pk=m['id']).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(worker.delete_expired(), 1)
        ids = [x['id'] for x in self.sara.get(f"{url}messages/").data]
        self.assertNotIn(m['id'], ids)
        self.assertIn(msgs[0]['id'], ids)
        self.assertEqual(self.ali.patch(url, {'disappear_after': 5}, format='json').status_code, 400)
        self.ali.patch(url, {'disappear_after': 0}, format='json')
        self.assertIsNone(self.ali.post(f"{url}messages/", {'content': 'تبقى'}, format='json').data['expires_at'])

    def test_group_admin_settings(self, push):
        g = self.group(self.ali, self.sara, self.omar)
        url = f"/api/conversations/{g['id']}/"
        # غير المشرف لا يغيّر الإعدادات
        self.assertEqual(self.sara.patch(url, {'only_admins_post': True}, format='json').status_code, 403)
        self.assertEqual(self.sara.patch(url, {'disappear_after': 86400}, format='json').status_code, 403)
        r = self.ali.patch(url, {'only_admins_post': True}, format='json')
        self.assertTrue(r.data['only_admins_post'])
        self.assertEqual(self.sara.get(url).data['can_post'], False)
        r = self.sara.post(f"{url}messages/", {'content': 'هل يمكنني؟'}, format='json')
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.ali.post(f"{url}messages/", {'content': 'إعلان'}, format='json').status_code, 201)
        # الوضع البطيء: رسالة كل 30 ثانية لغير المشرف
        self.ali.patch(url, {'only_admins_post': False, 'slow_mode': 30}, format='json')
        self.assertEqual(self.sara.post(f"{url}messages/", {'content': 'أولى'}, format='json').status_code, 201)
        r = self.sara.post(f"{url}messages/", {'content': 'ثانية'}, format='json')
        self.assertEqual(r.status_code, 429)
        self.assertIn('الوضع البطيء', r.data['detail'])
        self.assertEqual(self.ali.post(f"{url}messages/", {'content': 'المشرف لا يُقيَّد'}, format='json').status_code, 201)
        self.assertEqual(self.ali.patch(url, {'slow_mode': 7}, format='json').status_code, 400)
        # تعديل المعلومات: للمشرفين، ثم يسمح المشرف للجميع
        self.assertEqual(self.sara.patch(url, {'title': 'اسم جديد'}, format='json').status_code, 403)
        self.ali.patch(url, {'only_admins_edit': False}, format='json')
        r = self.sara.patch(url, {'title': 'اسم جديد'}, format='json')
        self.assertEqual((r.status_code, r.data['title'], r.data['can_edit_info']), (200, 'اسم جديد', True))
        # إعدادات المجموعة لا تنطبق على المحادثة الثنائية
        d = open_chat(self.ali, self.sara.user['id']).data
        self.assertEqual(self.ali.patch(f"/api/conversations/{d['id']}/", {'slow_mode': 30}, format='json').status_code, 400)

    def test_invite_link(self, push):
        g = self.group(self.ali, self.sara)
        stranger = self.register('zaid')
        self.assertEqual(self.sara.post(f"/api/conversations/{g['id']}/invite/").status_code, 403)
        code = self.ali.post(f"/api/conversations/{g['id']}/invite/").data['invite_code']
        self.assertEqual(len(code), 22)
        self.assertEqual(self.ali.get(f"/api/conversations/{g['id']}/").data['invite_code'], code)
        self.assertNotIn('invite_code', self.sara.get(f"/api/conversations/{g['id']}/").data)  # للمشرفين فقط
        # غريب لا يعرف أحداً: يرى المعاينة، ثم ينضم
        preview = stranger.get(f'/api/invite/{code}/').data
        self.assertEqual((preview['title'], preview['member_count'], preview['is_member']), ('مجموعة', 2, False))
        r = stranger.post(f'/api/invite/{code}/')
        self.assertEqual((r.status_code, r.data['id']), (201, g['id']))
        self.assertEqual(stranger.post(f'/api/invite/{code}/').status_code, 200)  # مرة ثانية: لا تكرار
        self.assertIn('انضم عبر رابط الدعوة', self.ali.get(f"/api/conversations/{g['id']}/messages/").data[-1]['content'])
        # رابط جديد يلغي القديم، والحذف يلغيه
        new = self.ali.post(f"/api/conversations/{g['id']}/invite/").data['invite_code']
        self.assertEqual(self.register('huda').get(f'/api/invite/{code}/').status_code, 404)
        self.ali.delete(f"/api/conversations/{g['id']}/invite/")
        self.assertEqual(self.register('noor').post(f'/api/invite/{new}/').status_code, 404)
        d = open_chat(self.ali, self.sara.user['id']).data
        self.assertEqual(self.ali.post(f"/api/conversations/{d['id']}/invite/").status_code, 400)

    def test_scheduled_messages(self, push):
        self.subscribe_push(self.sara)
        d = open_chat(self.ali, self.sara.user['id']).data
        url = f"/api/conversations/{d['id']}/scheduled/"
        soon = (timezone.now() + timedelta(minutes=5)).isoformat()
        self.assertEqual(self.ali.post(url, {'content': 'x', 'send_at': timezone.now().isoformat()}, format='json').status_code, 400)
        self.assertEqual(self.ali.post(url, {'content': '', 'send_at': soon}, format='json').status_code, 400)
        a = self.ali.post(url, {'content': 'تذكير بالمحاضرة', 'send_at': soon}, format='json').data
        b = self.ali.post(url, {'content': 'بهدوء', 'send_at': soon, 'silent': True}, format='json').data
        self.assertEqual([s['id'] for s in self.ali.get(url).data], [a['id'], b['id']])
        self.assertEqual(self.sara.get(url).data, [])  # مجدولاتي لا يراها غيري
        self.assertEqual(self.sara.delete(f"/api/scheduled/{a['id']}/").status_code, 404)
        self.assertEqual(worker.send_due_scheduled(), 0)  # لم يحن الوقت
        ScheduledMessage.objects.update(send_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(worker.send_due_scheduled(), 2)
        self.assertEqual(worker.send_due_scheduled(), 0)  # لا تُرسل مرتين
        contents = [m['content'] for m in self.sara.get(f"/api/conversations/{d['id']}/messages/").data]
        self.assertEqual(contents[-2:], ['تذكير بالمحاضرة', 'بهدوء'])
        self.assertEqual(push.call_count, 1)  # الصامتة بلا إشعار
        self.assertEqual(self.ali.get(url).data, [])
        # إلغاء
        c = self.ali.post(url, {'content': 'ألغِها', 'send_at': soon}, format='json').data
        self.assertEqual(self.ali.delete(f"/api/scheduled/{c['id']}/").status_code, 204)
        self.assertFalse(ScheduledMessage.objects.exists())

    def test_scheduled_fails_if_no_longer_allowed(self, push):
        g = self.group(self.ali, self.sara)
        url = f"/api/conversations/{g['id']}/scheduled/"
        s = self.sara.post(url, {'content': 'لاحقاً', 'send_at': (timezone.now() + timedelta(hours=1)).isoformat()},
                           format='json').data
        self.ali.patch(f"/api/conversations/{g['id']}/", {'only_admins_post': True}, format='json')
        ScheduledMessage.objects.update(send_at=timezone.now())
        worker.send_due_scheduled()
        row = self.sara.get(url).data[0]
        self.assertEqual((row['id'], row['status']), (s['id'], 'failed'))
        self.assertIn('للمشرفين', row['error'])
        self.assertEqual(self.sara.post(url, {'content': 'x', 'send_at': (timezone.now() + timedelta(hours=1)).isoformat()},
                                        format='json').status_code, 403)


class WebSocketRulesTests(Base, TransactionTestCase):
    """القواعد نفسها عبر WebSocket: المجموعة «للمشرفين فقط» والوضع البطيء."""

    def setUp(self):
        cache.clear()

    async def _connect(self, client, conv_id):
        comm = WebsocketCommunicator(application, f'/ws/chat/{conv_id}/?token={client.token}')
        connected, _ = await comm.connect()
        self.assertTrue(connected)
        return comm

    def test_ws_respects_group_rules(self):
        from asgiref.sync import async_to_sync
        ali, sara = self.register('ali'), self.register('sara')
        g = self.group(ali, sara)
        ali.patch(f"/api/conversations/{g['id']}/", {'only_admins_post': True}, format='json')

        async def run():
            comm = await self._connect(sara, g['id'])
            await comm.send_json_to({'type': 'message', 'content': 'مرحباً'})
            reply = await comm.receive_json_from(timeout=3)
            self.assertEqual((reply['type'], reply['detail']), ('error', 'not_allowed'))
            await comm.disconnect()
        async_to_sync(run)()
        ali.patch(f"/api/conversations/{g['id']}/", {'only_admins_post': False, 'slow_mode': 60}, format='json')

        async def run_slow():
            comm = await self._connect(sara, g['id'])
            await comm.send_json_to({'type': 'message', 'content': 'أولى'})
            first = await comm.receive_json_from(timeout=3)
            while first['type'] != 'message':
                first = await comm.receive_json_from(timeout=3)
            await comm.send_json_to({'type': 'message', 'content': 'ثانية'})
            reply = await comm.receive_json_from(timeout=3)
            while reply['type'] not in ('error',):
                reply = await comm.receive_json_from(timeout=3)
            self.assertEqual(reply['detail'], 'slow_mode')
            await comm.disconnect()
        async_to_sync(run_slow)()
        self.assertEqual(Message.objects.filter(content='ثانية').count(), 0)
