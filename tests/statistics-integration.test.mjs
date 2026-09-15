import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { addDays } from '../packages/scheduler/src/index.ts';

test('production statistics reflect real corrected records and isolate users without writes', { timeout: 90_000 }, async () => {
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const config = JSON.parse(status.stdout);
  const base = new URL(config.API_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname));
  assert.equal(base.port, '55321');
  const users = [];
  const server = spawn(process.execPath, ['apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '0'], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: config.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let origin;
  let output = '';
  server.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-4096); origin = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0] ?? origin; });
  server.stderr.resume();
  async function auth(path, body, admin = false, method = 'POST') {
    const key = admin ? config.SERVICE_ROLE_KEY : config.ANON_KEY;
    const response = await fetch(new URL(path, base), { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
    assert.ok(response.ok, 'temporary local Auth operation succeeds');
    return response.json();
  }
  async function user() {
    const email = `phase8-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const created = await auth('/auth/v1/admin/users', { email, password, email_confirm: true }, true);
    users.push(created.id);
    return (await auth('/auth/v1/token?grant_type=password', { email, password })).access_token;
  }
  async function api(path, token, body) {
    return fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  }
  async function data(path, token, body, expected = 200) {
    const response = await api(path, token, body);
    assert.equal(response.status, expected, `HTTP ${path.split('?')[0]}`);
    return response.json();
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      assert.equal(server.exitCode, null, 'temporary Next process remains alive');
      if (origin) { try { ready = (await api('/api/health')).ok; } catch { /* startup */ } }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    const alice = await user();
    const bob = await user();
    assert.equal((await api('/api/statistics')).status, 401);
    const empty = await data('/api/statistics', alice);
    assert.equal(empty.summary.events, 0);
    assert.equal(empty.days.length, 30);
    const today = empty.today;
    const yesterday = addDays(today, -1);
    const { resource } = await data('/api/resources/books', alice, { title: 'Statistics temporary book', totalPages: 100, currentPage: 10 }, 201);
    await data(`/api/resources/books/${resource.id}/plan`, alice, { options: { mode: 'PACE', startDate: addDays(today, 1), timezone: 'Asia/Seoul', dailyPages: 20, minutesPerPage: 1, availability: Array.from({ length: 7 }, (_, i) => ({ isoWeekday: i + 1, availableMinutes: 60 })) } }, 201);
    const read = () => data(`/api/workspace?resourceId=${resource.id}`, alice);
    let workspace = await read();
    let planVersion = workspace.plans[0].version;
    let progressVersion = 0;
    async function record(extra) {
      const result = await data(`/api/resources/books/${resource.id}/progress`, alice, { kind: 'LEARNING', idempotencyKey: randomUUID(), planId: workspace.plans[0].id, expectedPlanVersion: planVersion, expectedProgressVersion: progressVersion, studyDate: yesterday, endPage: 20, durationMinutes: 5, memo: 'private statistics memo', ...extra }, 201);
      planVersion = result.planVersion; progressVersion = result.progressVersion;
      return result;
    }
    const original = await record({});
    await record({ kind: 'CORRECTION', eventId: original.eventId, studyDate: today, endPage: 15, durationMinutes: null });
    await record({ kind: 'REVIEW', studyDate: today, startPage: 11, endPage: 15, durationMinutes: 3 });
    workspace = await read();
    const response = await api('/api/statistics', alice);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const stats = await response.json();
    assert.deepEqual(stats.summary, { learningPages: 5, reviewPages: 5, recordedMinutes: 3, events: 2, timedEvents: 1, untimedEvents: 1, activeDays: 1, minutesPerPage: null, learningMinutes: 0 });
    assert.equal(JSON.stringify(stats).includes('private statistics memo'), false);
    assert.equal(stats.resources[0].id, resource.id);
    const previous = await data(`/api/statistics?from=${yesterday}&to=${yesterday}`, alice);
    assert.equal(previous.summary.events, 0, 'later correction removes original from yesterday');
    assert.equal((await data(`/api/statistics?resourceId=${resource.id}`, alice)).summary.learningPages, 5);
    assert.equal((await api(`/api/statistics?resourceId=${resource.id}`, bob)).status, 404);
    assert.equal((await data('/api/statistics', bob)).summary.events, 0);
    assert.equal((await api(`/api/statistics?to=${addDays(today, 1)}`, alice)).status, 400);
    assert.deepEqual(await read(), workspace, 'statistics never mutate progress, plans or sessions');
    // A real learning-room session's settled time must show up in statistics for its local date.
    // (Midnight-crossing date math is Postgres-only and already covered by pgTAP; here we only
    // verify the live session -> settle() -> RPC -> API wiring for the common same-day case.)
    const workspaceId = randomUUID();
    const deviceId = randomUUID();
    const learningCommand = (action, fields, expected = 200) =>
      data('/api/learning/commands', alice, { action, requestId: randomUUID(), ...fields }, expected);
    await learningCommand('CREATE', { workspaceId, title: 'Statistics room check', prompt: '', kind: 'WRITING' }, 201);
    let { session } = await learningCommand('START', { workspaceId, deviceId, timezone: 'Asia/Seoul' });
    // settle() caps each interval at last_activity_at + 60s (idle pause), so accumulate
    // ~20 minutes as 24 backdated 50-second heartbeats instead of one long jump.
    for (let beat = 0; beat < 24; beat++) {
      const back = new Date(Date.now() - 50 * 1000).toISOString();
      const patch = await fetch(new URL(`/rest/v1/learning_sessions?id=eq.${session.id}`, base), {
        method: 'PATCH',
        headers: { apikey: config.SERVICE_ROLE_KEY, Authorization: `Bearer ${config.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ last_seen_at: back, last_activity_at: back }),
        signal: AbortSignal.timeout(10000),
      });
      assert.ok(patch.ok, 'backdate the session for settle() to accumulate elapsed time');
      ({ session } = await learningCommand('HEARTBEAT', { sessionId: session.id, deviceId, generation: session.generation, activity: true }));
    }
    assert.ok(session.elapsed_seconds >= 1195 && session.elapsed_seconds <= 1260, `server settled about 20 minutes (got ${session.elapsed_seconds}s)`);
    // Yesterday..today so a run near Asia/Seoul midnight still sees the whole session.
    const withRoom = await data(`/api/statistics?from=${yesterday}&to=${today}`, alice);
    assert.ok(withRoom.days.some((day) => day.date === today && day.learningMinutes > 0), 'today carries room minutes');
    assert.ok(Math.abs(withRoom.summary.learningMinutes - Math.round(session.elapsed_seconds / 60)) <= 1, `room minutes match the settled session (got ${withRoom.summary.learningMinutes}, session ${session.elapsed_seconds}s)`);
    await learningCommand('END', { sessionId: session.id, deviceId, generation: session.generation, activity: false });
  } finally {
    try { for (const id of users) await auth(`/auth/v1/admin/users/${id}`, undefined, true, 'DELETE'); }
    finally { if (server.exitCode === null) { const ended = once(server, 'exit'); server.kill(); await ended; } }
  }
});
