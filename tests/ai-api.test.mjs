import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiHandlers } from '../apps/web/src/lib/ai-api.ts';
const id = '12345678-1234-4234-9234-123456789abc';
const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const book = { id, title: 'Test', author: null, total_pages: 100, initial_completed_workload: 0, type: 'BOOK', status: 'ACTIVE', replan_required: false };
const request = body => new Request('http://localhost', { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' } });
function fixture({ enabled = true, missing = false, stored = [], queueStatus = 200 } = {}) {
  const writes = [];
  let jobs = stored;
  const handler = createAiHandlers(config, enabled, async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(init.headers.Authorization, 'Bearer user-token');
    if (path.endsWith('/user')) return Response.json({ id });
    if (path.endsWith('/resources')) return Response.json(missing ? [] : [book]);
    if (path.endsWith('/ai_jobs')) return Response.json(jobs);
    if (path.endsWith('/rpc/enqueue_ai_job')) {
      const body = JSON.parse(init.body); writes.push(body);
      if (queueStatus !== 200) return Response.json({}, { status: queueStatus });
      jobs = [{ id, kind: body.p_kind, source_revision: body.p_source_revision, status: 'PENDING', input: body.p_input, result: null, model: null, error_code: null, created_at: '2026-09-13', updated_at: '2026-09-13' }];
      return Response.json(id);
    }
    assert.notEqual(init.method, 'POST');
    return Response.json([]);
  });
  return { handler, writes };
}
test('AI enqueue builds owned server context and does not return private job input', async () => {
  const { handler, writes } = fixture();
  const response = await handler.POST(request({ kind: 'BOOK_ANALYSIS', outline: 'Chapter one' }), id);
  assert.equal(response.status, 202);
  assert.equal(writes[0].p_input.book.title, 'Test');
  assert.equal(writes[0].p_input.outline, 'Chapter one');
  const body = await response.json();
  assert.equal(body.job.status, 'PENDING');
  assert.equal('input' in body.job, false);
  assert.equal('lease_token' in body.job, false);
});
test('disabled AI returns honest availability and cannot enqueue', async () => {
  const { handler, writes } = fixture({ enabled: false });
  assert.equal((await (await handler.GET(request(), id)).json()).available, false);
  assert.equal((await handler.POST(request({ kind: 'COACH' }), id)).status, 503);
  assert.equal(writes.length, 0);
});
test('AI authentication ownership invalid input and queue cap are enforced', async () => {
  const { handler, writes } = fixture();
  assert.equal((await handler.POST(new Request('http://localhost'), id)).status, 401);
  assert.equal((await handler.POST(request({ kind: 'COACH', user_id: id }), id)).status, 400);
  assert.equal((await fixture({ missing: true }).handler.POST(request({ kind: 'COACH' }), id)).status, 404);
  assert.equal((await fixture({ queueStatus: 429 }).handler.POST(request({ kind: 'COACH' }), id)).status, 429);
  assert.equal(writes.length, 0);
});
test('invalid persisted provider output is never exposed as a completed insight', async () => {
  const { handler } = fixture({ stored: [{ id, kind: 'COACH', status: 'COMPLETED', result: { secret: 'raw-provider' }, input: { outline: '' }, source_revision: 'old', created_at: '2026-09-13', updated_at: '2026-09-13' }] });
  const response = await handler.GET(request(), id);
  const body = await response.json();
  assert.equal(body.jobs[0].status, 'FAILED');
  assert.equal(body.jobs[0].result, null);
  assert.equal(JSON.stringify(body).includes('raw-provider'), false);
});
