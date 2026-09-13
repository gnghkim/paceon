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
    const fallback = await api('/api/books/search?q=book&provider=yes24');
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
  } finally {
    try {
      for (const id of users) await auth(`/auth/v1/admin/users/${id}`, undefined, true, 'DELETE');
    } finally {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    }
  }
});
