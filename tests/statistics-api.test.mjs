import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStatisticsHandler } from '../apps/web/src/lib/statistics-api.ts';
const id = '12345678-1234-4234-9234-123456789abc';
const config = { url: 'http://127.0.0.1:55321', key: 'public' };
function fixture({ missing = false, corrupt = false, unavailable = false, corruptReview = false } = {}) {
  const calls = [];
  const GET = createStatisticsHandler(config, async (url, init) => {
    url = new URL(url);
    calls.push(url);
    assert.equal(init.headers.Authorization, 'Bearer user-token');
    assert.equal(init.cache, 'no-store');
    if (url.pathname.endsWith('/rpc/learning_daily_minutes')) return Response.json([]);
    assert.equal(init.method ?? 'GET', 'GET');
    if (url.pathname.endsWith('/user')) return Response.json({ id });
    assert.equal(url.searchParams.get('user_id'), `eq.${id}`);
    if (unavailable) return Response.json({ message: 'secret internal' }, { status: 500 });
    if (url.pathname.endsWith('/learner_profiles')) return Response.json([{ timezone: 'Asia/Seoul' }]);
    if (url.pathname.endsWith('/resources')) return Response.json(missing ? [] : [{ id, title: 'Book', source: 'MANUAL', type: 'BOOK', workload_unit: 'PAGE', total_pages: 100, initial_completed_workload: 10 }]);
    if (url.pathname.endsWith('/progress_events')) return Response.json([{ id: 'event', resource_id: id, event_type: corruptReview ? 'REVIEW' : 'LEARNING', start_page: corruptReview ? null : corrupt ? 12 : 11, end_page: corruptReview ? null : 20, completed_workload: 10, duration_minutes: 5, study_date: '2026-09-13', memo: 'secret memo' }]);
    return Response.json([]);
  }, () => new Date('2026-09-12T16:00:00Z'));
  const request = query => new Request(`http://localhost/api/statistics${query ?? ''}`, { headers: { authorization: 'Bearer user-token' } });
  return { GET, request, calls };
}
test('statistics authenticates first and uses saved timezone for default period', async () => {
  const { GET, request, calls } = fixture();
  assert.equal((await GET(new Request('http://localhost/api/statistics?from=bad'))).status, 401);
  assert.equal(calls.length, 0);
  const response = await GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const data = await response.json();
  assert.equal(data.today, '2026-09-13');
  assert.equal(data.from, '2026-08-15');
  assert.equal(data.summary.learningPages, 10);
  assert.equal(JSON.stringify(data).includes('secret'), false);
});
test('statistics validates ranges and optional resource ID', async () => {
  const { GET, request } = fixture();
  for (const query of ['?from=no', '?from=2026-02-29', '?to=2026-09-14', '?from=2020-01-01', '?resourceId=no', '?from=2026-09-13&from=2026-09-12', '?unexpected=1']) assert.equal((await GET(request(query))).status, 400, query);
  assert.equal((await GET(request(`?resourceId=${id}`))).status, 200);
  const foreign = fixture({ missing: true });
  assert.equal((await foreign.GET(foreign.request(`?resourceId=${id}`))).status, 404);
});
test('statistics protects complete-history semantics and fails safely', async () => {
  const { GET, request, calls } = fixture();
  await GET(request('?to=2026-09-12'));
  const query = calls.find(url => url.pathname.endsWith('/progress_events')).searchParams;
  assert.equal(query.has('study_date'), false);
  assert.equal(query.has('and'), false);
  const broken = fixture({ corrupt: true });
  assert.equal((await broken.GET(broken.request())).status, 409);
  const brokenReview = fixture({ corruptReview: true });
  assert.equal((await brokenReview.GET(brokenReview.request())).status, 409);
  const down = fixture({ unavailable: true });
  const response = await down.GET(down.request());
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes('secret'), false);
});
test('statistics page through histories and refuse truncated totals at the row cap', async () => {
  for (const endless of [false, true]) {
    let pages = 0;
    const GET = createStatisticsHandler(config, async (address) => {
      const url = new URL(address);
      if (url.pathname.endsWith('/user')) return Response.json({ id });
      if (url.pathname.endsWith('/learner_profiles')) return Response.json([]);
      if (url.pathname.endsWith('/resources')) return Response.json([{ id, title: 'Book', source: 'MANUAL', type: 'BOOK', workload_unit: 'PAGE', total_pages: 100, initial_completed_workload: 10 }]);
      if (url.pathname.endsWith('/rpc/learning_daily_minutes')) return Response.json([]);
      const offset = Number(url.searchParams.get('offset'));
      pages++;
      return Response.json(Array.from({ length: endless || offset === 0 ? 500 : 1 }, (_, i) => ({ id: `review-${offset + i}`, resource_id: id, event_type: 'REVIEW', start_page: 1, end_page: 1, completed_workload: 1, duration_minutes: null, study_date: '2026-09-13' })));
    }, () => new Date('2026-09-13T00:00:00Z'));
    const response = await GET(new Request('http://localhost/api/statistics', { headers: { authorization: 'Bearer user-token' } }));
    if (endless) { assert.equal(response.status, 503); assert.equal(pages, 40); }
    else { assert.equal(response.status, 200); assert.equal((await response.json()).summary.reviewPages, 501); assert.equal(pages, 2); }
  }
});
test('learning room minutes merge into every day and the summary, requested for the full range regardless of resourceId', async () => {
  const calls = [];
  const GET = createStatisticsHandler(config, async (url, init) => {
    url = new URL(url);
    if (url.pathname.endsWith('/user')) return Response.json({ id });
    if (url.pathname.endsWith('/learner_profiles')) return Response.json([{ timezone: 'Asia/Seoul' }]);
    if (url.pathname.endsWith('/resources')) return Response.json([{ id, title: 'Book', source: 'MANUAL', type: 'BOOK', workload_unit: 'PAGE', total_pages: 100, initial_completed_workload: 10 }]);
    if (url.pathname.endsWith('/progress_events')) return Response.json([]);
    if (url.pathname.endsWith('/rpc/learning_daily_minutes')) {
      calls.push(JSON.parse(init.body));
      return Response.json([{ study_date: '2026-09-12', minutes: 45.4 }, { study_date: '2026-09-13', minutes: 10 }]);
    }
    return Response.json([]);
  }, () => new Date('2026-09-12T16:00:00Z'));
  const request = query => new Request(`http://localhost/api/statistics${query ?? ''}`, { headers: { authorization: 'Bearer user-token' } });
  const data = await (await GET(request(`?resourceId=${id}`))).json();
  assert.deepEqual(calls[0], { p_from: '2026-08-15', p_to: '2026-09-13' });
  assert.equal(data.days.find(d => d.date === '2026-09-12').learningMinutes, 45);
  assert.equal(data.days.find(d => d.date === '2026-09-13').learningMinutes, 10);
  assert.equal(data.summary.learningMinutes, 55);
});
test('learning room minutes fetch failure fails the whole request with 503', async () => {
  const GET = createStatisticsHandler(config, async (url) => {
    url = new URL(url);
    if (url.pathname.endsWith('/user')) return Response.json({ id });
    if (url.pathname.endsWith('/learner_profiles')) return Response.json([]);
    if (url.pathname.endsWith('/resources')) return Response.json([]);
    if (url.pathname.endsWith('/rpc/learning_daily_minutes')) return Response.json({ message: 'down' }, { status: 500 });
    return Response.json([]);
  }, () => new Date('2026-09-12T16:00:00Z'));
  const response = await GET(new Request('http://localhost/api/statistics', { headers: { authorization: 'Bearer user-token' } }));
  assert.equal(response.status, 503);
});
