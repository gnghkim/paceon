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

// 계획 없이 읽은 기록. 요청에 planId가 아예 없으면 이 길로 간다.
const unplanned = { kind: 'LEARNING', idempotencyKey: key, expectedProgressVersion: 0, studyDate: '2026-09-13', endPage: 30, durationMinutes: 25, memo: '' };
function unplannedStub({ book = {}, plans = [], events = [], rpc } = {}) {
  const writes = [];
  const handler = createProgressHandler(config, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/user')) return Response.json({ id });
    if (path.endsWith('/rpc/submit_unplanned_book_progress')) {
      writes.push(JSON.parse(init.body));
      return rpc ? rpc() : Response.json({ completedThroughPage: 30, unplanned: true, replanStatus: 'applied', forecastBefore: null, forecastAfter: null, conflicts: [] });
    }
    if (path.endsWith('/rpc/submit_book_progress')) throw new Error('a plan-less record must not take the planned path');
    if (path.endsWith('/resources')) return Response.json([{ id, type: 'BOOK', status: 'ACTIVE', progress_version: 0, total_pages: 100, initial_completed_workload: 10, ...book }]);
    if (path.endsWith('/plans')) return Response.json(plans);
    if (path.endsWith('/progress_events')) return Response.json(events);
    if (path.endsWith('/learner_profiles')) return Response.json([{ timezone: 'UTC' }]);
    return Response.json([]);
  });
  return { handler, writes };
}
const todayUtc = () => new Date().toISOString().slice(0, 10);

test('reading a book with no plan is recorded without a schedule', async () => {
  const { handler, writes } = unplannedStub();
  const response = await handler(request({ ...unplanned, studyDate: todayUtc() }), id);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).unplanned, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['p_as_of_date', 'p_expected_initial', 'p_expected_total', 'p_request', 'p_resource_id']);
  assert.equal(writes[0].p_as_of_date, todayUtc(), 'today is where the reader lives');
  assert.equal(writes[0].p_request.endPage, 30);
  assert.equal(writes[0].p_request.durationMinutes, 25, 'the timer minutes travel with the record');
});

test('a book that has a plan must record through it, so its schedule stays true', async () => {
  for (const status of ['ACTIVE', 'PAUSED', 'COMPLETED']) {
    const { handler, writes } = unplannedStub({ plans: [{ id, resource_id: id, status, version: 1 }] });
    assert.equal((await handler(request({ ...unplanned, studyDate: todayUtc() }), id)).status, 409, status);
    assert.deepEqual(writes, []);
  }
});

test('a plan-less record is checked before anything is written', async () => {
  const cases = [
    [{ ...unplanned, endPage: 10 }, 400, 'pages already read'],
    [{ ...unplanned, endPage: 101 }, 400, 'past the last page'],
    [{ ...unplanned, studyDate: '2999-01-01' }, 400, 'a future day'],
    [{ ...unplanned, kind: 'REVIEW', startPage: 1 }, 409, 'a review needs a book being re-read'],
    [{ ...unplanned, expectedProgressVersion: 3 }, 409, 'an old revision'],
  ];
  for (const [payload, status, label] of cases) {
    const { handler, writes } = unplannedStub();
    const final = payload.studyDate === unplanned.studyDate ? { ...payload, studyDate: todayUtc() } : payload;
    assert.equal((await handler(request(final), id)).status, status, label);
    assert.deepEqual(writes, [], label);
  }
});

test('an archived book, or a finished one asked to read on, is not recorded', async () => {
  for (const book of [{ status: 'ARCHIVED' }, { status: 'COMPLETED' }]) {
    const { handler, writes } = unplannedStub({ book });
    assert.equal((await handler(request({ ...unplanned, studyDate: todayUtc() }), id)).status, 409, book.status);
    assert.deepEqual(writes, []);
  }
});

test('a finished book takes a review of the pages read again only while it is re-read', async () => {
  const review = { kind: 'REVIEW', idempotencyKey: key, expectedProgressVersion: 0, studyDate: todayUtc(), startPage: 1, endPage: 40, durationMinutes: 30, memo: '' };
  const finished = { status: 'COMPLETED', reading_started_at: '2026-09-01T00:00:00Z', rereading_since: null };
  const idle = unplannedStub({ book: finished });
  assert.equal((await idle.handler(request(review), id)).status, 409, 'not being re-read');
  assert.deepEqual(idle.writes, []);
  const rereading = unplannedStub({ book: { ...finished, rereading_since: '2026-10-01T00:00:00Z' } });
  assert.equal((await rereading.handler(request(review), id)).status, 201);
  assert.equal(rereading.writes[0].p_request.startPage, 1);
  assert.equal(rereading.writes[0].p_request.kind, 'REVIEW');
  const outside = unplannedStub({ book: { ...finished, rereading_since: '2026-10-01T00:00:00Z' } });
  assert.equal((await outside.handler(request({ ...review, endPage: 101 }), id)).status, 400, 'inside the book');
  assert.equal((await outside.handler(request({ ...review, startPage: 50 }), id)).status, 400, 'ends after it begins');
  assert.deepEqual(outside.writes, []);
});

test('the latest plan-less reading can be corrected, even on a book it finished', async () => {
  const latest = { id: key.replace(/d$/, 'e'), event_type: 'LEARNING', start_page: 11, end_page: 100, completed_workload: 90, study_date: todayUtc(), duration_minutes: 30 };
  const { handler, writes } = unplannedStub({ book: { status: 'COMPLETED' }, events: [latest] });
  const correction = { kind: 'CORRECTION', idempotencyKey: key, expectedProgressVersion: 0, studyDate: todayUtc(), endPage: 40, eventId: latest.id, durationMinutes: 30, memo: '' };
  assert.equal((await handler(request(correction), id)).status, 201);
  assert.equal(writes[0].p_request.eventId, latest.id);
});

// 다시 나누기 미리보기. 저장하지 않고 바뀔 일정만 돌려준다.
const replanBody = { kind: 'REPLAN', planId: id, idempotencyKey: key, expectedPlanVersion: 1, expectedProgressVersion: 0, mode: 'DEADLINE', targetDate: '2999-01-10' };
function replanStub({ minutesPerPage = 2 } = {}) {
  const writes = [];
  const handler = createProgressHandler(config, async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path.endsWith('/user')) return Response.json({ id });
    if (path.startsWith('/rest/v1/rpc/')) {
      writes.push({ path, body: JSON.parse(init.body) });
      return Response.json({ completedThroughPage: 0, replanStatus: 'applied', forecastBefore: null, forecastAfter: '2999-01-10', conflicts: [] });
    }
    if (path.endsWith('/resources')) return Response.json([{ id, type: 'BOOK', status: 'ACTIVE', progress_version: 0, total_pages: 120, initial_completed_workload: 0 }]);
    if (path.endsWith('/plans')) return Response.json([{ id, resource_id: id, status: 'ACTIVE', version: 1, mode: 'BALANCED', preferred_daily_workload: 30, target_date: '2999-01-20', start_date: '2026-09-13', timezone: 'UTC', minutes_per_page: minutesPerPage, forecast_date: '2999-01-20' }]);
    if (path.endsWith('/availability_rules')) return Response.json([1, 2, 3, 4, 5, 6, 7].map(iso_weekday => ({ iso_weekday, available_minutes: 60 })));
    if (path.endsWith('/learner_profiles')) return Response.json([{ timezone: 'UTC' }]);
    return Response.json([]);
  });
  return { handler, writes };
}
const previewRequest = payload => new Request('http://localhost/api/resources/books/x/progress?preview=1', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(payload) });

test('a replan preview shows the schedule it would make and writes nothing', async () => {
  const { handler, writes } = replanStub();
  const response = await handler(previewRequest({ ...replanBody, targetDate: null, mode: 'PACE', dailyPages: 30 }), id);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.preview, true);
  assert.equal(body.status, 'ok');
  assert.equal(body.forecastBefore, '2999-01-20');
  assert.equal(body.minutesPerPage, 2);
  assert.equal(body.sessions[0].startPage, 1);
  assert.equal(body.sessions[0].endPage, 30, 'sixty minutes at two minutes a page holds thirty pages');
  assert.equal(body.forecastAfter, body.sessions.at(-1).studyDate);
  assert.deepEqual(writes, []);
});

test('the preview uses a corrected reading speed', async () => {
  const { handler } = replanStub();
  const slow = await (await handler(previewRequest({ ...replanBody, mode: 'PACE', dailyPages: 100, targetDate: null }), id)).json();
  assert.equal(slow.status, 'conflict', 'a hundred pages do not fit in an hour at two minutes a page');
  const fast = await (await handler(previewRequest({ ...replanBody, mode: 'PACE', dailyPages: 100, targetDate: null, minutesPerPage: 0.5 }), id)).json();
  assert.equal(fast.status, 'ok');
  assert.equal(fast.minutesPerPage, 0.5);
  assert.equal(fast.sessions[0].endPage, 100);
});

test('only a replan can be previewed', async () => {
  const { handler, writes } = replanStub();
  assert.equal((await handler(previewRequest(body), id)).status, 400);
  assert.deepEqual(writes, []);
});

test('confirming sends the corrected speed in both the request and the candidate', async () => {
  const { handler, writes } = replanStub();
  const response = await handler(request({ ...replanBody, mode: 'PACE', dailyPages: 100, targetDate: null, minutesPerPage: 0.5 }), id);
  assert.equal(response.status, 201);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/rest/v1/rpc/submit_book_progress');
  assert.equal(writes[0].body.p_request.minutesPerPage, 0.5);
  assert.equal(writes[0].body.p_candidate.minutesPerPage, 0.5);
});

test('a reading speed the plan could not store is refused', async () => {
  const { handler, writes } = replanStub();
  for (const minutesPerPage of [0.05, 1441, 0.1234, '1'])
    assert.equal((await handler(request({ ...replanBody, minutesPerPage }), id)).status, 400, String(minutesPerPage));
  assert.equal((await handler(request({ ...body, minutesPerPage: 1 }), id)).status, 400, 'a reading record cannot carry a speed');
  assert.deepEqual(writes, []);
});
