import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

test('production progress routes persist records, retries, corrections, completion and conflict recovery', { timeout: 90_000 }, async () => {
  // Local credentials stay in memory. Create and remove only these temporary users.
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const config = JSON.parse(status.stdout);
  const base = new URL(config.API_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  assert.equal(base.port, '55321', 'integration test is restricted to PaceOn Local');
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
    assert.ok(response.ok, 'temporary local Auth operation succeeds');
    return response.json();
  }
  async function user() {
    const email = `phase5-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const created = await auth('/auth/v1/admin/users', { email, password, email_confirm: true }, true);
    users.push(created.id);
    const session = await auth('/auth/v1/token?grant_type=password', { email, password });
    return { id: created.id, token: session.access_token };
  }
  async function api(path, token, body) {
    return fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  }
  async function read(owner, bookId) {
    const response = await api(`/api/workspace?resourceId=${bookId}`, owner.token);
    assert.equal(response.status, 200);
    return response.json();
  }
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  async function setup(owner, totalPages = 100, dailyPages = 20) {
    const saved = await api('/api/resources/books', owner.token, { title: 'Temporary progress integration', totalPages });
    assert.equal(saved.status, 201);
    const book = (await saved.json()).resource;
    const planned = await api(`/api/resources/books/${book.id}/plan`, owner.token, { options: {
      mode: 'PACE', startDate: tomorrow, timezone: 'UTC', dailyPages, minutesPerPage: 1,
      availability: Array.from({ length: 7 }, (_, i) => ({ isoWeekday: i + 1, availableMinutes: 60 })),
    } });
    assert.equal(planned.status, 201);
    const state = await read(owner, book.id);
    return { bookId: book.id, planId: state.plans[0].id, progressVersion: 0, planVersion: state.plans[0].version };
  }
  const payload = (state, extra = {}) => ({ kind: 'LEARNING', idempotencyKey: randomUUID(), planId: state.planId,
    expectedPlanVersion: state.planVersion, expectedProgressVersion: state.progressVersion, studyDate: today, endPage: 5, ...extra });
  async function submit(owner, state, body, expected = 201) {
    const response = await api(`/api/resources/books/${state.bookId}/progress`, owner.token, body);
    assert.equal(response.status, expected, `${body.kind} submission HTTP status`);
    const result = await response.json();
    if (expected < 300) { state.progressVersion = result.progressVersion; state.planVersion = result.planVersion; }
    return result;
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      assert.equal(server.exitCode, null, 'isolated production server stays running');
      if (origin) { try { ready = (await api('/api/health')).ok; } catch { /* Startup in progress. */ } }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'isolated production server is ready');
    const alice = await user();
    const bob = await user();
    const state = await setup(alice, 200);
    const firstBody = payload(state);
    assert.equal((await api(`/api/resources/books/${state.bookId}/progress`, undefined, firstBody)).status, 401);
    await submit(bob, state, firstBody, 404);
    const races = await Promise.all(Array.from({ length: 4 }, () => api(`/api/resources/books/${state.bookId}/progress`, alice.token, firstBody)));
    for (const response of races) assert.ok([200, 201].includes(response.status), 'concurrent exact retries succeed');
    const raceResults = await Promise.all(races.map(response => response.json()));
    const first = raceResults[0];
    for (const result of raceResults) assert.deepEqual(result, first, 'concurrent exact retries return the same submission');
    state.progressVersion = first.progressVersion; state.planVersion = first.planVersion;
    assert.equal(first.completedThroughPage, 5);
    assert.equal(first.replanStatus, 'applied');
    assert.deepEqual(await submit(alice, state, firstBody, 200), first, 'exact retry returns identical persisted result');
    await submit(alice, state, { ...firstBody, endPage: 6 }, 409);
    await submit(alice, state, { ...firstBody, idempotencyKey: randomUUID() }, 409);
    const corrected = await submit(alice, state, payload(state, { kind: 'CORRECTION', eventId: first.eventId, endPage: 3 }));
    assert.equal(corrected.completedThroughPage, 3);
    const reviewed = await submit(alice, state, payload(state, { kind: 'REVIEW', startPage: 1, endPage: 3, durationMinutes: 60 }));
    assert.equal(reviewed.completedThroughPage, 3, 'review never advances reading progress');
    const completed = await submit(alice, state, payload(state, { endPage: 200 }));
    assert.equal(completed.completedThroughPage, 200);
    assert.equal(completed.forecastAfter, today);
    let workspace = await read(alice, state.bookId);
    assert.equal(workspace.progress[state.bookId].percent, 100);
    assert.equal(workspace.plans[0].status, 'COMPLETED');
    assert.deepEqual(await submit(alice, state, firstBody, 200), first, 'old replay works after completion');
    // Replays return old revisions; restore the live revisions before reopening.
    state.progressVersion = completed.progressVersion; state.planVersion = completed.planVersion;
    const reopened = await submit(alice, state, payload(state, { kind: 'CORRECTION', eventId: completed.eventId, endPage: 50 }));
    assert.equal(reopened.completedThroughPage, 50);
    workspace = await read(alice, state.bookId);
    assert.equal(workspace.plans[0].status, 'ACTIVE');
    assert.equal(workspace.progress[state.bookId].completedThroughPage, 50);
    assert.ok(workspace.events.some(event => event.event_type === 'VOID'));
    assert.ok(workspace.events.some(event => event.id === completed.eventId), 'corrected learning remains in history');
    assert.equal(workspace.sessions.reduce((sum, session) => sum + session.planned_workload, 0), 150);
    assert.equal((await api(`/api/workspace?resourceId=${state.bookId}`, bob.token)).status, 404);

    const secondCompletion = await submit(alice, state, payload(state, { endPage: 200 }));
    await submit(alice, state, { kind: 'REPLAN', idempotencyKey: randomUUID(), planId: state.planId,
      expectedPlanVersion: state.planVersion, expectedProgressVersion: state.progressVersion, mode: 'DEADLINE', targetDate: tomorrow });
    const pendingReopen = await submit(alice, state, payload(state, { kind: 'CORRECTION', eventId: secondCompletion.eventId, endPage: 50 }));
    assert.equal(pendingReopen.replanStatus, 'pending');
    const pendingReopenWorkspace = await read(alice, state.bookId);
    assert.equal(pendingReopenWorkspace.resources[0].status, 'ACTIVE');
    assert.equal(pendingReopenWorkspace.plans[0].status, 'ACTIVE', 'conflicted correction still reopens the completed plan');
    assert.equal(pendingReopenWorkspace.resources[0].replan_required, true);
    assert.equal(pendingReopenWorkspace.progress[state.bookId].completedThroughPage, 50);
    const resolvedReopen = await submit(alice, state, { kind: 'REPLAN', idempotencyKey: randomUUID(), planId: state.planId,
      expectedPlanVersion: state.planVersion, expectedProgressVersion: state.progressVersion, mode: 'PACE', targetDate: null });
    assert.equal(resolvedReopen.replanStatus, 'applied');

    const slow = await setup(bob, 10, 2);
    for (const endPage of [1, 2]) await submit(bob, slow, payload(slow, { endPage, durationMinutes: 60 }));
    const pendingBody = payload(slow, { endPage: 3, durationMinutes: 60 });
    const pending = await submit(bob, slow, pendingBody);
    assert.equal(pending.replanStatus, 'pending', 'observed slow pace cannot fit original daily pages');
    assert.equal(pending.completedThroughPage, 3, 'actual reading commits despite schedule conflict');
    const pendingWorkspace = await read(bob, slow.bookId);
    assert.equal(pendingWorkspace.resources[0].replan_required, true);
    assert.equal(pendingWorkspace.progress[slow.bookId].completedThroughPage, 3);
    assert.deepEqual(await submit(bob, slow, pendingBody, 200), pending);
    const recovered = await submit(bob, slow, { kind: 'REPLAN', idempotencyKey: randomUUID(), planId: slow.planId,
      expectedPlanVersion: slow.planVersion, expectedProgressVersion: slow.progressVersion, dailyPages: 1 });
    assert.equal(recovered.replanStatus, 'applied');
    const recoveredWorkspace = await read(bob, slow.bookId);
    assert.equal(recoveredWorkspace.resources[0].replan_required, false);
    assert.equal(recoveredWorkspace.events.filter(event => event.event_type === 'LEARNING').length, 3);
    assert.ok(recoveredWorkspace.sessions.every(session => session.estimated_minutes === 60));
  } finally {
    try {
      for (const id of users) await auth(`/auth/v1/admin/users/${id}`, undefined, true, 'DELETE');
    } finally {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    }
  }
});
