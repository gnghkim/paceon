import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceHandlers } from '../apps/web/src/lib/workspace-api.ts';
const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const id = '12345678-1234-4234-9234-123456789abc';
const options = { mode: 'PACE', startDate: '2090-09-14', timezone: 'Asia/Seoul', dailyPages: 20, minutesPerPage: 1, availability: [{ isoWeekday: 1, availableMinutes: 60 }] };
const request = body => new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const resource = { id, title: 'Book', type: 'BOOK', status: 'ACTIVE', total_pages: 100, initial_completed_workload: 20 };
test('preview uses owned book and server scheduler, never writes', async () => {
  const api = createWorkspaceHandlers(config, async (url, init) => {
    assert.notEqual(init.method, 'POST');
    const path = new URL(url).pathname;
    if (path.endsWith('/learner_profiles')) assert.equal(new URL(url).searchParams.get('order'), 'user_id.asc');
    return Response.json(path.endsWith('/user') ? { id } : path.endsWith('/resources') ? [resource] : []);
  });
  const response = await api.PLAN(request({ options, preview: true }), id);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).schedule.sessions[0].startPage, 21);
});
test('foreign or missing resource is 404 and invalid input cannot reach persistence', async () => {
  const api = createWorkspaceHandlers(config, async url => Response.json(new URL(url).pathname.endsWith('/user') ? { id } : []));
  assert.equal((await api.PLAN(request({ options }), id)).status, 404);
  assert.equal((await api.PLAN(request({ options: { ...options, startDate: 'bad' } }), id)).status, 400);
  assert.equal((await api.PLAN(request({ options }), 'not-a-uuid')).status, 400);
});
test('read model rejects reversed or unbounded calendar queries', async () => {
  const api = createWorkspaceHandlers(config, async url => Response.json(new URL(url).pathname.endsWith('/user') ? { id } : []));
  for (const query of ['?from=2026-02-30', '?from=2026-01-01&to=2027-01-01', '?from=2026-10-01&to=2026-09-01']) assert.equal((await api.GET(new Request(`http://localhost${query}`, { headers: { authorization: 'Bearer token' } }))).status, 400);
});
