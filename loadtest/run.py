"""
اختبار ضغط: آلاف المستخدمين الوهميين يستخدمون النظام بنفس اللحظة.
كل مستخدم:
  1) يفتح الاتصال المباشر (WebSocket /ws/presence/) ويبقيه مفتوح
  2) يجيب قائمة محادثاته، ويبحث عن ناس، ويفتح رسائل محادثة
  3) يدز رسائل، ونقيس شكد تاخذ حتى توصل للطرف الثاني (end-to-end)
التشغيل:
  python manage.py loadtest_users --count 2000 --out /tmp/lt_users.json     (مرة وحدة، بمجلد backend)
  python loadtest/run.py --base http://localhost:8000 --users 2000 --messages 3
"""
import argparse
import asyncio
import json
import random
import statistics
import time
from collections import defaultdict

import httpx
import websockets

lat = defaultdict(list)       # زمن كل نوع طلب (ثواني)
errors = defaultdict(int)
delivery = []                 # زمن وصول الرسالة للطرف الثاني
sent = set()                  # الرسائل اللي دزيناها (marker)
received = set()              # الرسائل اللي وصلت لطرف ثاني
connected = 0


async def timed(name, coro):
    t = time.perf_counter()
    try:
        r = await coro
        if getattr(r, 'status_code', 200) >= 400:
            errors[f'{name} {r.status_code}'] += 1
        else:
            lat[name].append(time.perf_counter() - t)
        return r
    except Exception as e:  # noqa: BLE001 — نعد كل أنواع الفشل
        errors[f'{name} {type(e).__name__}'] += 1
        return None


async def listen(ws, stop, uid):
    """نستلم الأحداث المباشرة: إذا وصلت رسالة اختبار نحسب شكد تأخرت."""
    try:
        while not stop.is_set():
            raw = await asyncio.wait_for(ws.recv(), timeout=1)
            e = json.loads(raw)
            if e.get('type') == 'inbox' and e['message']['sender']['id'] != uid:
                marker = e['message'].get('content', '')
                if marker.startswith('lt:'):
                    # وقت الإرسال مكتوب داخل الرسالة (حتى لو المرسل بعملية ثانية)
                    delivery.append(time.time() - float(marker.split(':')[2]))
                    received.add(marker)
    except (asyncio.TimeoutError, TimeoutError):
        if not stop.is_set():
            return await listen(ws, stop, uid)
    except Exception:  # noqa: BLE001
        pass


async def user(u, args, client, stop, start_gate):
    global connected
    headers = {'Authorization': f"Token {u['token']}"}
    ws_url = args.base.replace('http', 'ws', 1) + f"/ws/presence/?token={u['token']}"
    await start_gate.wait()
    await asyncio.sleep(random.uniform(0, args.ramp))
    ws = None
    t = time.perf_counter()
    try:
        ws = await websockets.connect(ws_url, open_timeout=30, ping_interval=None, max_queue=None)
        lat['ws connect'].append(time.perf_counter() - t)
        connected += 1
    except Exception as e:  # noqa: BLE001
        errors[f'ws connect {type(e).__name__}'] += 1
    listener = asyncio.create_task(listen(ws, stop, u['id'])) if ws else None

    await timed('GET conversations', client.get('/api/conversations/', headers=headers))
    await timed('GET users?q', client.get('/api/users/?q=lt_1', headers=headers))
    conv = random.choice(u['convs']) if u['convs'] else None
    if conv:
        await timed('GET messages', client.get(f'/api/conversations/{conv}/messages/', headers=headers))
    for _ in range(args.messages):
        await asyncio.sleep(random.uniform(0, args.think))
        if not conv:
            break
        marker = f"lt:{u['id']}:{time.time():.6f}:{random.random():.8f}"
        sent.add(marker)
        await timed('POST message', client.post(f'/api/conversations/{conv}/messages/', headers=headers,
                                                  json={'content': marker}))
    await stop.wait()
    if listener:
        await listener
    if ws:
        await ws.close()


def pct(values, p):
    if not values:
        return 0
    values = sorted(values)
    return values[min(len(values) - 1, int(len(values) * p))]


async def run_slice(args, users, out):
    """عملية وحدة تشغل جزء من المستخدمين وتكتب النتائج الخام."""
    limits = httpx.Limits(max_connections=len(users), max_keepalive_connections=len(users))
    async with httpx.AsyncClient(base_url=args.base, timeout=60, limits=limits) as client:
        stop, gate = asyncio.Event(), asyncio.Event()
        tasks = [asyncio.create_task(user(u, args, client, stop, gate)) for u in users]
        gate.set()
        await asyncio.sleep(args.ramp + args.think * args.messages + args.hold)
        stop.set()
        # اللي بعده عالق (السيرفر ما رد) نلغيه بعد مهلة قصيرة ونحسبه فشل
        _, pending = await asyncio.wait(tasks, timeout=15)
        for t in pending:
            t.cancel()
        if pending:
            errors['ما خلص (السيرفر ما لحّگ)'] += len(pending)
        await asyncio.gather(*tasks, return_exceptions=True)
    json.dump({'lat': lat, 'errors': errors, 'delivery': delivery, 'sent': list(sent),
               'received': list(received), 'connected': connected}, open(out, 'w'))


def child(args, users, out):
    asyncio.run(run_slice(args, users, out))


def main():
    import multiprocessing as mp
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://localhost:8000')
    ap.add_argument('--users-file', default='/tmp/lt_users.json')
    ap.add_argument('--users', type=int, default=2000)
    ap.add_argument('--messages', type=int, default=3)
    ap.add_argument('--ramp', type=float, default=5, help='كل المستخدمين يبدون خلال هذي الثواني')
    ap.add_argument('--think', type=float, default=3, help='أقصى انتظار بين رسالة ورسالة')
    ap.add_argument('--hold', type=float, default=15, help='شكد نبقى متصلين بعد آخر رسالة')
    ap.add_argument('--procs', type=int, default=4, help='عمليات الاختبار (حتى جهاز الاختبار نفسه ما يصير هو البطيء)')
    ap.add_argument('--label', default='')
    args = ap.parse_args()

    users = json.load(open(args.users_file))[: args.users]
    t0 = time.perf_counter()
    procs = []
    for i in range(args.procs):
        out = f'/tmp/lt_part_{i}.json'
        p = mp.Process(target=child, args=(args, users[i::args.procs], out))
        p.start()
        procs.append((p, out))
    all_lat, all_err, all_del, all_sent, all_recv, conn = defaultdict(list), defaultdict(int), [], set(), set(), 0
    for p, out in procs:
        p.join()
        d = json.load(open(out))
        for k, v in d['lat'].items():
            all_lat[k] += v
        for k, v in d['errors'].items():
            all_err[k] += v
        all_del += d['delivery']
        all_sent |= set(d['sent'])
        all_recv |= set(d['received'])
        conn += d['connected']
    total = time.perf_counter() - t0
    requests = sum(len(v) for v in all_lat.values())
    print(f"\n=== {args.label} {len(users)} مستخدم، {total:.0f} ثانية ({args.procs} عمليات اختبار) ===")
    print(f"{'الطلب':<20}{'العدد':>8}{'p50 ms':>10}{'p95 ms':>10}{'p99 ms':>10}")
    for name, v in sorted(all_lat.items()):
        print(f"{name:<20}{len(v):>8}{pct(v, .5)*1000:>10.0f}{pct(v, .95)*1000:>10.0f}{pct(v, .99)*1000:>10.0f}")
    print(f"{'وصول الرسالة':<20}{len(all_del):>8}{pct(all_del, .5)*1000:>10.0f}{pct(all_del, .95)*1000:>10.0f}{pct(all_del, .99)*1000:>10.0f}")
    print(f"اتصالات WebSocket ناجحة: {conn}/{len(users)} | الطلبات الناجحة: {requests} | الأخطاء: {sum(all_err.values())}")
    for k, v in sorted(all_err.items(), key=lambda x: -x[1])[:8]:
        print(f"  ✗ {k}: {v}")
    lost = len(all_sent - all_recv)
    print(f"رسائل انرسلت: {len(all_sent)} | وصلت لطرف ثاني: {len(all_sent & all_recv)} | ما وصلت: {lost}")
    json.dump({'label': args.label, 'users': len(users),
               'lat': {k: [pct(v, .5), pct(v, .95), pct(v, .99), len(v)] for k, v in all_lat.items()},
               'delivery': [pct(all_del, .5), pct(all_del, .95), pct(all_del, .99), len(all_del)],
               'errors': dict(all_err), 'connected': conn, 'sent': len(all_sent), 'lost': lost},
              open(f"/tmp/lt_result_{args.label or 'run'}.json", 'w'))


if __name__ == '__main__':
    main()
