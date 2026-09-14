import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgressHandler } from '../apps/web/src/lib/progress-api.ts';
const id = '12345678-1234-4234-9234-123456789abc';
const key = '12345678-1234-4234-9234-123456789abd';
const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const body = { kind: 'LEARNING', planId: id, idempotencyKey: key, expectedPlanVersion: 1, expectedProgressVersion: 0, studyDate: '2026-09-13', endPage: 30, durationMinutes: null, memo: '' };
const request = payload => new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(payload) });
test('exact progress replay is returned before loading mutable book state', async () => {
  const handler = createProgressHandler(config, async (url, init) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/user')) return Response.json({ id });
    assert.ok(path.endsWith('/progress_submissions'));
    assert.equal(init.headers.Authorization, 'Bearer token');
    return Response.json([{ resource_id: id, request: body, result: { progressVersion: 1, replanStatus: 'applied' } }]);
  });
  const response = await handler(request(body), id);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).progressVersion, 1);
});
test('same key with different content is rejected instead of replayed', async () => {
  const handler = createProgressHandler(config, async url => Response.json(new URL(url).pathname.endsWith('/user') ? { id } : [{ resource_id: id, request: body, result: {} }]));
  assert.equal((await handler(request({ ...body, endPage: 40 }), id)).status, 409);
});

test('retry rechecks ledger when original commits after the first lookup', async () => {
  let reads = 0;
  const handler = createProgressHandler(config, async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/user')) return Response.json({ id });
    if (path.endsWith('/progress_submissions')) return Response.json(++reads === 1 ? [] : [{ resource_id: id, request: body, result: { progressVersion: 1 } }]);
    if (path.endsWith('/resources')) return Response.json([{ id, status: 'ACTIVE', progress_version: 1 }]);
    if (path.endsWith('/plans')) return Response.json([{ id, resource_id: id, status: 'ACTIVE', version: 2 }]);
    return Response.json([]);
  });
  const response = await handler(request(body), id);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).progressVersion, 1);
  assert.equal(reads, 2);
});
test('unauthenticated, invalid and foreign progress submissions fail before writes', async () => {
  const handler = createProgressHandler(config, async (url, init) => {
    assert.notEqual(init.method, 'POST');
    return Response.json(new URL(url).pathname.endsWith('/user') ? { id } : []);
  });
  assert.equal((await handler(new Request('http://localhost'), id)).status, 401);
  assert.equal((await handler(request({ ...body, endPage: -1 }), id)).status, 400);
  assert.equal((await handler(request(body), id)).status, 404);
});

test('exact retry replays when old revisions and newly committed events form a mixed snapshot', async () => {
  let reads = 0;
  const result = { progressVersion: 1, planVersion: 2, completedThroughPage: 30 };
  const handler = createProgressHandler(config, async (url, init) => {
    assert.notEqual(init.method, 'POST', 'mixed retry reaches no second write');
    const path = new URL(url).pathname;
    if (path.endsWith('/user')) return Response.json({ id });
    if (path.endsWith('/progress_submissions')) return Response.json(++reads === 1 ? [] : [{ resource_id: id, request: body, result }]);
    if (path.endsWith('/resources')) return Response.json([{ id, status: 'ACTIVE', progress_version: 0, total_pages: 100, initial_completed_workload: 0 }]);
    if (path.endsWith('/plans')) return Response.json([{ id, resource_id: id, status: 'ACTIVE', version: 1, mode: 'PACE', preferred_daily_workload: 20, target_date: null, start_date: '2026-09-13', timezone: 'UTC', minutes_per_page: 1 }]);
    if (path.endsWith('/progress_events')) return Response.json([{ id: key, event_type: 'LEARNING', start_page: 1, end_page: 30, completed_workload: 30, study_date: body.studyDate, duration_minutes: null, session_id: null }]);
    return Response.json([]);
  });
  const response = await handler(request(body), id);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), result);
  assert.equal(reads, 2);
});
