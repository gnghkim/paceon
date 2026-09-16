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

const patch = body => new Request('http://localhost', { method: 'PATCH', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('the learning goal is upserted alone so a stale client cannot move the shared timezone', async () => {
  let written = null;
  const api = createWorkspaceHandlers(config, async (url, init) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/user')) return Response.json({ id });
    assert.equal(init.method, 'POST');
    assert.equal(target.pathname, '/rest/v1/learner_profiles');
    assert.equal(target.searchParams.get('on_conflict'), 'user_id');
    assert.match(init.headers.Prefer, /merge-duplicates/);
    written = JSON.parse(init.body);
    return new Response(null, { status: 204 });
  });
  const response = await api.PROFILE(patch({ dailyLearningMinutes: 10 }));
  assert.equal(response.status, 200);
  assert.deepEqual(written, { user_id: id, daily_learning_minutes: 10 });
  assert.equal((await response.json()).dailyLearningMinutes, 10);
});
test('clearing the goal is allowed but out-of-range or unknown fields are rejected', async () => {
  let writes = 0;
  const api = createWorkspaceHandlers(config, async url => {
    if (new URL(url).pathname.endsWith('/user')) return Response.json({ id });
    writes++;
    return new Response(null, { status: 204 });
  });
  assert.equal((await api.PROFILE(patch({ dailyLearningMinutes: null }))).status, 200);
  for (const bad of [{ dailyLearningMinutes: 0 }, { dailyLearningMinutes: 1441 }, { dailyLearningMinutes: 10.5 }, { dailyLearningMinutes: 10, timezone: 'UTC' }, {}])
    assert.equal((await api.PROFILE(patch(bad))).status, 400);
  assert.equal(writes, 1);
});
test('the read model reports the saved goal and defaults to none', async () => {
  const withGoal = createWorkspaceHandlers(config, async url => Response.json(
    new URL(url).pathname.endsWith('/user') ? { id }
      : new URL(url).pathname.endsWith('/learner_profiles') ? [{ user_id: id, timezone: 'Asia/Seoul', daily_learning_minutes: 15 }] : []));
  assert.equal((await (await withGoal.GET(new Request('http://localhost', { headers: { authorization: 'Bearer token' } }))).json()).dailyLearningMinutes, 15);
  const none = createWorkspaceHandlers(config, async url => Response.json(new URL(url).pathname.endsWith('/user') ? { id } : []));
  assert.equal((await (await none.GET(new Request('http://localhost', { headers: { authorization: 'Bearer token' } }))).json()).dailyLearningMinutes, null);
});
