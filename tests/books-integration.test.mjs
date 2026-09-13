import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

test('production Next routes register corrected books with real Auth and isolated persistence', { timeout: 60_000 }, async () => {
  // Keep all local keys and tokens in memory. Never print server output or Auth bodies.
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const config = JSON.parse(status.stdout);
  const base = new URL(config.API_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  const users = [];
  const server = spawn(process.execPath, ['apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '0'], {
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: config.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let origin;
  let output = '';
  server.stdout.on('data', chunk => {
    output = (output + chunk.toString()).slice(-4096);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) origin = match[0];
  });
  server.stderr.resume();
  async function auth(path, body, admin = false, method = 'POST') {
    const response = await fetch(new URL(path, base), { method, headers: { apikey: admin ? config.SERVICE_ROLE_KEY : config.ANON_KEY, Authorization: `Bearer ${admin ? config.SERVICE_ROLE_KEY : config.ANON_KEY}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
    assert.ok(response.ok, 'Local Auth request succeeds');
    return response.json();
  }
  async function user() {
    const email = `phase3-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const created = await auth('/auth/v1/admin/users', { email, password, email_confirm: true }, true);
    users.push(created.id);
    const session = await auth('/auth/v1/token?grant_type=password', { email, password });
    return { id: created.id, token: session.access_token };
  }
  async function api(path, token, body) {
    return fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      assert.equal(server.exitCode, null, 'isolated Next server stays running');
      if (origin) { try { ready = (await api('/api/health')).ok; } catch { /* Wait for startup. */ } }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'production server becomes ready');
    const alice = await user();
    const bob = await user();
    assert.equal((await api('/api/resources/books')).status, 401);
    assert.equal((await api('/api/resources/books', 'invalid-token', { title: 'Bad', totalPages: 10 })).status, 401);
    const fallback = await api('/api/books/search?q=book&provider=manual');
    assert.equal(fallback.status, 501);
    assert.equal((await fallback.json()).manualEntryAvailable, true);
    const saved = await api('/api/resources/books', alice.token, { title: 'Manual after fallback', totalPages: 200, currentPage: 50, user_id: bob.id });
    assert.equal(saved.status, 201);
    const row = (await saved.json()).resource;
    assert.equal(row.user_id, alice.id);
    assert.equal(row.initial_completed_workload, 50);
    const corrected = await api('/api/resources/books', alice.token, { title: 'Corrected metadata', source: 'GOOGLE_BOOKS', sourceId: 'example-volume', isbn: '978-0-306-40615-7', totalPages: 320, currentPage: 0 });
    assert.equal(corrected.status, 201);
    assert.equal((await corrected.json()).resource.isbn, '9780306406157');
    assert.equal((await api('/api/resources/books', alice.token, { title: 'Invalid', totalPages: 10, currentPage: 11 })).status, 400);
    const aliceList = await (await api('/api/resources/books', alice.token)).json();
    const bobList = await (await api('/api/resources/books', bob.token)).json();
    assert.equal(aliceList.resources.length, 2);
    assert.deepEqual(bobList.resources, []);
    assert.equal((await (await api('/api/resources/books?limit=1&offset=1', alice.token)).json()).resources.length, 1);
    const today = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const options = { mode: 'PACE', startDate, timezone: 'Asia/Seoul', dailyPages: 20, minutesPerPage: 1,
      availability: Array.from({ length: 7 }, (_, i) => ({ isoWeekday: i + 1, availableMinutes: 60 })) };
    const preview = await api(`/api/resources/books/${row.id}/plan`, alice.token, { options, preview: true });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).schedule.sessions[0].startPage, 51);
    assert.equal((await api(`/api/resources/books/${row.id}/plan`, bob.token, { options, preview: true })).status, 404);
    const duplicateSaves = await Promise.all([1, 2].map(() => api(`/api/resources/books/${row.id}/plan`, alice.token, { options })));
    assert.deepEqual(duplicateSaves.map(r => r.status).sort(), [201, 409]);
    const workspace = await (await api('/api/workspace', alice.token)).json();
    assert.equal(workspace.plans.length, 1);
    assert.equal(workspace.sessions.reduce((sum, s) => sum + s.planned_workload, 0), 150);
    assert.equal(workspace.availability.length, 7);
    assert.equal((await (await api('/api/workspace', bob.token)).json()).plans.length, 0);
    assert.equal((await api(`/api/workspace?resourceId=${row.id}`, bob.token)).status, 404);
    const secondBook = aliceList.resources.find(r => r.id !== row.id);
    const overbooked = await api(`/api/resources/books/${secondBook.id}/plan`, alice.token, { options: { ...options, dailyPages: 50 } });
    assert.equal(overbooked.status, 409, 'shared capacity is reserved');
    const partial = await fetch(new URL('/rest/v1/rpc/create_initial_book_plan', base), { method: 'POST', headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_resource_id: secondBook.id, p_expected_total: 320, p_expected_completed: 0, p_options: options, p_forecast: startDate, p_sessions: [{ studyDate: startDate, startPage: 1, endPage: 20, estimatedMinutes: 20 }] }) });
    assert.equal(partial.status, 400, 'incomplete plan is rejected inside transaction');
    const goals = await fetch(new URL('/rest/v1/goals?select=id', base), { headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${alice.token}` } });
    assert.equal((await goals.json()).length, 1, 'failed saves leave no orphan goals');
    // A separate user's two books race for one shared daily budget.
    const competitors = [];
    for (const title of ['Race A', 'Race B']) {
      const response = await api('/api/resources/books', bob.token, { title, totalPages: 50 });
      assert.equal(response.status, 201);
      competitors.push((await response.json()).resource);
    }
    const decimalOptions = { ...options, dailyPages: 50, minutesPerPage: 1.1, availability: options.availability.map(a => ({ ...a, availableMinutes: 55 })) };
    const races = await Promise.all(competitors.map(book => api(`/api/resources/books/${book.id}/plan`, bob.token, { options: decimalOptions })));
    assert.deepEqual(races.map(r => r.status).sort(), [201, 409], 'different books cannot overbook shared minutes');
    const bobWorkspace = await (await api('/api/workspace', bob.token)).json();
    assert.equal(bobWorkspace.plans.length, 1);
    assert.equal(bobWorkspace.sessions[0].estimated_minutes, 55, 'decimal speed persists without IEEE over-rounding');
    const bobGoals = await fetch(new URL('/rest/v1/goals?select=id', base), { headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${bob.token}` } });
    assert.equal((await bobGoals.json()).length, 1, 'losing concurrent transaction leaves no orphan goal');
    const yes24 = await api('/api/resources/books', alice.token, { title: 'YES24 provenance fixture', totalPages: 584, source: 'YES24', sourceId: '12345678' });
    assert.equal(yes24.status, 201);
    const yes24Row = (await yes24.json()).resource;
    assert.equal(yes24Row.source, 'YES24');
    assert.equal(yes24Row.source_id, '12345678');
    assert.equal((await api(`/api/workspace?resourceId=${yes24Row.id}`, bob.token)).status, 404);
  } finally {
    try {
      for (const id of users) await auth(`/auth/v1/admin/users/${id}`, undefined, true, 'DELETE');
    } finally {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    }
  }
});
