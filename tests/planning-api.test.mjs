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
    // PostgREST answers a minimal-return upsert with an empty body and status 200.
    return new Response('', { status: 200 });
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
    return new Response('', { status: 200 });
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

const status = (body, method = 'PATCH') => new Request('http://localhost', { method, headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const route = (url) => new URL(url).pathname;
function stub(handler) {
  return createWorkspaceHandlers(config, async (url, init = {}) => {
    if (route(url).endsWith('/user')) return Response.json({ id });
    return handler(new URL(url), init) ?? Response.json([]);
  });
}
test('pausing a plan writes only that book and only a live plan', async () => {
  const writes = [];
  const api = stub((url, init) => {
    if (route(url) === '/rest/v1/resources' && init.method === undefined) return Response.json([resource]);
    if (route(url) === '/rest/v1/plans') {
      writes.push({ method: init.method, query: Object.fromEntries(url.searchParams), body: JSON.parse(init.body) });
      return Response.json([{ id: 'plan', status: 'PAUSED', version: 7 }]);
    }
  });
  const answer = await api.PLAN_STATUS(status({ status: 'PAUSED' }), id);
  assert.equal(answer.status, 200);
  // Every UPDATE to plans bumps the version, so the caller needs the new one to replan.
  assert.deepEqual(await answer.json(), { status: 'PAUSED', planId: 'plan', planVersion: 7 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.deepEqual(writes[0].body, { status: 'PAUSED' });
  assert.equal(writes[0].query.resource_id, `eq.${id}`);
  assert.equal(writes[0].query.user_id, `eq.${id}`);
  assert.equal(writes[0].query.status, 'in.(ACTIVE,PAUSED)');
  assert.equal(writes[0].query.select, 'id,status,version');
});
test('a book with no plan, an unknown book and a bad status never reach persistence', async () => {
  let writes = 0;
  const api = stub((url, init) => {
    if (route(url) === '/rest/v1/resources' && init.method === undefined) return Response.json([resource]);
    if (route(url) === '/rest/v1/plans') { writes++; return Response.json([]); }
  });
  assert.equal((await api.PLAN_STATUS(status({ status: 'PAUSED' }), id)).status, 404);
  for (const bad of [{ status: 'ARCHIVED' }, { status: 'ACTIVE', extra: 1 }, {}])
    assert.equal((await api.PLAN_STATUS(status(bad), id)).status, 400);
  assert.equal((await api.PLAN_STATUS(status({ status: 'PAUSED' }), 'not-a-uuid')).status, 400);
  const missing = stub(() => Response.json([]));
  assert.equal((await missing.PLAN_STATUS(status({ status: 'PAUSED' }), id)).status, 404);
  assert.equal(writes, 1);
});
test('an archived book cannot be restarted without being unarchived first', async () => {
  let writes = 0;
  const api = stub((url, init) => {
    if (route(url) === '/rest/v1/resources' && init.method === undefined) return Response.json([{ ...resource, status: 'ARCHIVED' }]);
    if (route(url) === '/rest/v1/plans') { writes++; return Response.json([{ id: 'plan' }]); }
  });
  assert.equal((await api.PLAN_STATUS(status({ status: 'ACTIVE' }), id)).status, 409);
  assert.equal(writes, 0);
  // Pausing an archived book's plan stays allowed so the pair cannot drift apart.
  assert.equal((await api.PLAN_STATUS(status({ status: 'PAUSED' }), id)).status, 200);
});
test('archiving pauses the plan before the book leaves the shelf', async () => {
  const calls = [];
  const api = stub((url, init) => {
    if (route(url) === '/rest/v1/resources' && init.method === undefined) return Response.json([resource]);
    if (init.method === 'PATCH') { calls.push([route(url), JSON.parse(init.body), Object.fromEntries(url.searchParams)]); return new Response('', { status: 200 }); }
  });
  assert.equal((await api.BOOK_STATUS(status({ status: 'ARCHIVED' }), id)).status, 200);
  assert.deepEqual(calls.map((c) => [c[0], c[1]]), [
    ['/rest/v1/plans', { status: 'PAUSED' }],
    ['/rest/v1/resources', { status: 'ARCHIVED' }],
  ]);
  assert.equal(calls[0][2].status, 'eq.ACTIVE');
});
test('unarchiving restores the book but leaves the plan paused for the reader to restart', async () => {
  const calls = [];
  const api = stub((url, init) => {
    if (route(url) === '/rest/v1/resources' && init.method === undefined) return Response.json([{ ...resource, status: 'ARCHIVED' }]);
    if (init.method === 'PATCH') { calls.push(route(url)); return new Response('', { status: 200 }); }
  });
  assert.equal((await api.BOOK_STATUS(status({ status: 'ACTIVE' }), id)).status, 200);
  assert.deepEqual(calls, ['/rest/v1/resources']);
});
test('a finished book keeps its status and unknown values are rejected', async () => {
  let writes = 0;
  const api = stub((url, init) => {
    if (route(url) === '/rest/v1/resources' && init.method === undefined) return Response.json([{ ...resource, status: 'COMPLETED' }]);
    if (init.method === 'PATCH') { writes++; return new Response('', { status: 200 }); }
  });
  assert.equal((await api.BOOK_STATUS(status({ status: 'ACTIVE' }), id)).status, 409);
  for (const bad of [{ status: 'PAUSED' }, { status: 'ARCHIVED', extra: 1 }, {}])
    assert.equal((await api.BOOK_STATUS(status(bad), id)).status, 400);
  assert.equal(writes, 0);
});
