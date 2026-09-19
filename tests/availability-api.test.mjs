import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAvailabilityHandler, isMovable } from '../apps/web/src/lib/availability-api.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const bookId = '22345678-1234-4234-9234-123456789abc';
const planId = '32345678-1234-4234-9234-123456789abc';
const put = (body) =>
  new Request('http://localhost', {
    method: 'PUT',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const today = new Date().toISOString().slice(0, 10);
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

const book = {
  id: bookId, user_id: user, title: '아주 작은 습관의 힘', type: 'BOOK', status: 'ACTIVE',
  total_pages: 100, initial_completed_workload: 0, progress_version: 0, replan_required: false,
};
const plan = {
  id: planId, user_id: user, resource_id: bookId, status: 'ACTIVE', version: 1, mode: 'PACE',
  start_date: day(-1), target_date: null, forecast_date: day(5), timezone: 'Asia/Seoul',
  preferred_daily_workload: 20, minutes_per_page: 1, created_at: '2026-09-01T00:00:00Z',
};
const session = (offset, start, end, extra = {}) => ({
  id: `${offset}0000000-1234-4234-9234-123456789abc`, user_id: user, resource_id: bookId, plan_id: planId,
  study_date: day(offset), start_page: start, end_page: end, planned_workload: end - start + 1,
  estimated_minutes: end - start + 1, status: 'PLANNED', is_locked: false, plan_version: 1,
  ...extra,
});

const rules = (minutes) =>
  [1, 2, 3, 4, 5, 6, 7].map((isoWeekday) => ({ isoWeekday, availableMinutes: minutes }));

/** Serves a fixed account and records every write so a test can prove none happened. */
function stub({ sessions = [], saved = 60, onWrite = () => {}, rpc = () => ({}) } = {}) {
  const writes = [];
  const api = createAvailabilityHandler(config, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (init.method && init.method !== 'GET') {
      const body = init.body ? JSON.parse(init.body) : null;
      writes.push({ path, method: init.method ?? 'POST', body });
      onWrite({ path, body });
      if (path.startsWith('/rest/v1/rpc/')) return Response.json(rpc(path, body));
      return new Response('', { status: 200 });
    }
    if (path === '/rest/v1/resources') return Response.json([book]);
    if (path === '/rest/v1/plans') return Response.json([plan]);
    if (path === '/rest/v1/progress_events') return Response.json([]);
    if (path === '/rest/v1/schedule_sessions') return Response.json(sessions);
    if (path === '/rest/v1/availability_rules')
      return Response.json(
        [1, 2, 3, 4, 5, 6, 7].map((iso_weekday) => ({
          id: `rule-${iso_weekday}`, user_id: user, iso_weekday, available_minutes: saved,
        })),
      );
    if (path === '/rest/v1/learner_profiles')
      return Response.json([{ user_id: user, timezone: 'Asia/Seoul', daily_learning_minutes: null }]);
    return Response.json([]);
  });
  return { api, writes };
}

test('a movable session is a future one nobody has touched', () => {
  const none = new Set();
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-20', status: 'PLANNED', is_locked: false }, '2026-09-16', none), true);
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-16', status: 'PLANNED', is_locked: false }, '2026-09-16', none), false);
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-20', status: 'COMPLETED', is_locked: false }, '2026-09-16', none), false);
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-20', status: 'IN_PROGRESS', is_locked: false }, '2026-09-16', none), false);
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-20', status: 'PLANNED', is_locked: true }, '2026-09-16', none), false);
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-20', status: 'PLANNED', is_locked: false }, '2026-09-16', new Set(['a'])), false);
  // A past day the learner skipped is replaced by the replan, not preserved.
  assert.equal(isMovable({ id: 'a', study_date: '2026-09-20', status: 'SKIPPED', is_locked: false }, '2026-09-16', none), true);
});

test('bad or duplicated weekdays never reach the database', async () => {
  const { api, writes } = stub();
  for (const bad of [
    { rules: [] },
    { rules: [{ isoWeekday: 0, availableMinutes: 60 }] },
    { rules: [{ isoWeekday: 8, availableMinutes: 60 }] },
    { rules: [{ isoWeekday: 1, availableMinutes: 0 }] },
    { rules: [{ isoWeekday: 1, availableMinutes: 1441 }] },
    { rules: [{ isoWeekday: 1, availableMinutes: 1.5 }] },
    { rules: [{ isoWeekday: 1, availableMinutes: 60 }, { isoWeekday: 1, availableMinutes: 30 }] },
    { rules: rules(60), extra: true },
    {},
  ])
    assert.equal((await api.PUT ?? (await api(put(bad)))).status, 400);
  assert.deepEqual(writes, []);
});

test('an unchanged budget is accepted without touching any plan', async () => {
  const { api, writes } = stub({ saved: 60, sessions: [session(2, 1, 20)] });
  const response = await api(put({ rules: rules(60) }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rescheduled, []);
  assert.deepEqual(writes, []);
});

test('a budget too small for the remaining pages is refused before anything is written', async () => {
  const { api, writes } = stub({ saved: 60, sessions: [session(2, 1, 20), session(3, 21, 40)] });
  // One minute a day cannot absorb 100 pages at a minute each before the horizon.
  const response = await api(put({ rules: [{ isoWeekday: 1, availableMinutes: 1 }] }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.conflicts.length, 1);
  assert.equal(body.conflicts[0].title, '아주 작은 습관의 힘');
  assert.deepEqual(writes, []);
});

test('a workable budget is written, the movable days are cleared, then the plan is refilled', async () => {
  const { api, writes } = stub({
    saved: 60,
    sessions: [session(-1, 1, 20, { status: 'COMPLETED' }), session(2, 21, 40), session(3, 41, 100)],
  });
  const response = await api(put({ rules: rules(120) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.rescheduled, ['아주 작은 습관의 힘']);
  assert.deepEqual(body.needsAttention, []);
  assert.deepEqual(
    writes.map((write) => write.path),
    ['/rest/v1/rpc/replace_availability_rules', '/rest/v1/schedule_sessions', '/rest/v1/rpc/submit_book_progress'],
  );
  assert.deepEqual(writes[0].body.p_rules, rules(120));
  assert.equal(writes[1].method, 'DELETE');
  // The finished day is preserved; only the two future days are cleared and replaced.
  assert.equal(writes[2].body.p_expected_sessions.length, 1);
  assert.equal(writes[2].body.p_expected_sessions[0].status, 'COMPLETED');
  assert.equal(writes[2].body.p_request.kind, 'REPLAN');
  assert.equal(writes[2].body.p_candidate.schedule.status, 'ok');
});

test('a book that fails to refill is flagged so the reader can fix it', async () => {
  const { api, writes } = stub({
    saved: 60,
    sessions: [session(2, 1, 50), session(3, 51, 100)],
    rpc: (path) => {
      if (path.endsWith('submit_book_progress')) throw new Error('capacity changed');
      return {};
    },
  });
  const response = await api(put({ rules: rules(120) }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.rescheduled, []);
  assert.deepEqual(body.needsAttention, [
    { resourceId: bookId, title: '아주 작은 습관의 힘', code: 'REPLAN_FAILED' },
  ]);
  const flag = writes.find((write) => write.path === '/rest/v1/resources');
  assert.deepEqual(flag.body, { replan_required: true });
  assert.equal(flag.method, 'PATCH');
});

test('an archived book is left out of the shared budget entirely', async () => {
  const writes = [];
  const api = createAvailabilityHandler(config, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (init.method && init.method !== 'GET') {
      writes.push(path);
      return path.startsWith('/rest/v1/rpc/') ? Response.json({}) : new Response('', { status: 200 });
    }
    if (path === '/rest/v1/resources') return Response.json([{ ...book, status: 'ARCHIVED' }]);
    if (path === '/rest/v1/plans') return Response.json([plan]);
    if (path === '/rest/v1/schedule_sessions') return Response.json([session(2, 1, 100)]);
    if (path === '/rest/v1/availability_rules')
      return Response.json([{ id: 'r', user_id: user, iso_weekday: 1, available_minutes: 60 }]);
    return Response.json([]);
  });
  const response = await api(put({ rules: [{ isoWeekday: 1, availableMinutes: 1 }] }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rescheduled, []);
  // The budget still changes; no plan needed rebuilding and none was touched.
  assert.deepEqual(writes, ['/rest/v1/rpc/replace_availability_rules']);
});

test('today is never treated as a movable day', () => {
  assert.equal(isMovable({ id: 'a', study_date: today, status: 'PLANNED', is_locked: false }, today, new Set()), false);
});

test('first availability save works without a book or plan and an identical retry makes no writes', async () => {
  let saved = [];
  const writes = [];
  const api = createAvailabilityHandler(config, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (init.method && init.method !== 'GET') {
      writes.push(path);
      assert.equal(path, '/rest/v1/rpc/replace_availability_rules');
      saved = JSON.parse(init.body).p_rules.map(rule => ({ iso_weekday: rule.isoWeekday, available_minutes: rule.availableMinutes }));
      return Response.json({});
    }
    if (path === '/rest/v1/availability_rules') return Response.json(saved);
    // A newly registered course does not require a book or an existing plan.
    if (path === '/rest/v1/resources' && target.searchParams.get('workload_unit') === 'eq.UNIT')
      return Response.json([{ id: bookId, title: '첫 강의', type: 'COURSE', workload_unit: 'UNIT', status: 'ACTIVE' }]);
    return Response.json([]);
  });
  const input = { rules: [{ isoWeekday: 2, availableMinutes: 45 }] };
  const response = await api(put(input));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rules: input.rules, rescheduled: [], needsAttention: [] });
  assert.deepEqual(saved, [{ iso_weekday: 2, available_minutes: 45 }]);
  assert.equal((await api(put(input))).status, 200);
  assert.deepEqual(writes, ['/rest/v1/rpc/replace_availability_rules']);
});
