import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMaterialImportHandlers } from '../apps/web/src/lib/material-import-api.ts';
import { PageFetchError } from '../apps/web/src/lib/safe-fetch.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const importId = '82345678-1234-4234-9234-123456789abc';

const coursePage = `<html><head><title>업무 자동화 실전</title></head><body>
  <p>${'이 강의는 반복 업무를 줄이는 방법을 다룹니다. '.repeat(12)}</p>
  <h2>커리큘럼</h2>
  <div>섹션 1. 시작하기</div><div>2개</div><div>∙ (23분)</div>
  <div><b>1.</b><a>강의 소개</a><i>미리보기</i><em>20:15</em></div>
  <div><b>2.</b><a>수업 자료</a><em>02:36</em></div>
  </body></html>`;
const page = (html, contentType = 'text/html; charset=utf-8') => async (url) => ({ finalUrl: url, contentType, body: Buffer.from(html) });

function stub({ ai = true, fetchPage = page(coursePage), insert, rows = [] } = {}) {
  const writes = [];
  const api = createMaterialImportHandlers(
    config,
    ai,
    async (url, init = {}) => {
      const target = new URL(url);
      const path = target.pathname;
      if (path.endsWith('/user')) return Response.json({ id: user });
      if (path === '/rest/v1/material_imports' && init.method === 'POST') {
        writes.push(JSON.parse(init.body));
        return insert ? insert() : Response.json([{ id: importId }], { status: 201 });
      }
      if (path === '/rest/v1/material_imports') return Response.json(rows);
      if (path === '/rest/v1/learner_profiles') return Response.json([{ user_id: user, timezone: 'Asia/Seoul', daily_learning_minutes: null }]);
      if (path === '/rest/v1/availability_rules')
        return Response.json([1, 2, 3, 4, 5].map((iso_weekday) => ({ user_id: user, iso_weekday, available_minutes: 60 })));
      return Response.json([]);
    },
    fetchPage,
  );
  return { api, writes };
}
const post = (body) =>
  new Request('http://localhost/api/resources/materials/import', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = () => new Request(`http://localhost/api/resources/materials/import/${importId}`, { headers: { authorization: 'Bearer token' } });

test('a page is read, outlined by rule at once, and queued for the AI', async () => {
  const { api, writes } = stub();
  const response = await api.START(post({ url: 'https://www.example-course.com/c/1' }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.importId, importId);
  assert.equal(body.pageTitle, '업무 자동화 실전');
  assert.deepEqual(body.fallback, [
    { title: '시작하기', section: true },
    { title: '강의 소개', minutes: 21 },
    { title: '수업 자료', minutes: 3 },
  ]);
  assert.deepEqual(body.freeMinutesByWeekday, [60, 60, 60, 60, 60, 0, 0]);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].user_id, user);
  assert.deepEqual(writes[0].context, { freeMinutesByWeekday: [60, 60, 60, 60, 60, 0, 0] });
  assert.ok(writes[0].input.includes('강의 소개') && !writes[0].input.includes('<div>'), 'text, not markup, is queued');
  assert.deepEqual(Object.keys(writes[0]).sort(), ['context', 'input', 'page_title', 'source_url', 'user_id'], 'status and result are never set by the web');
});

test('with AI off the rule-based outline still comes back and nothing is queued', async () => {
  const { api, writes } = stub({ ai: false });
  const body = await (await api.START(post({ url: 'https://www.example-course.com/c/1' }))).json();
  assert.equal(body.importId, null);
  assert.equal(body.fallback.length, 3);
  assert.deepEqual(writes, []);
});

test('an address the fetcher refuses never reaches the queue, and says what to do instead', async () => {
  for (const reason of ['PRIVATE_ADDRESS', 'IP_LITERAL', 'NOT_HTTPS', 'HTTP_ERROR', 'TIMEOUT', 'TOO_LARGE']) {
    const { api, writes } = stub({ fetchPage: async () => { throw new PageFetchError(reason); } });
    const response = await api.START(post({ url: 'https://whatever.example-course.com/' }));
    assert.equal(response.status, 422, reason);
    assert.match((await response.json()).error, /[가-힣]/);
    assert.deepEqual(writes, []);
  }
});

test('a page with almost no text is called what it is, a page drawn by script', async () => {
  const { api, writes } = stub({ fetchPage: page('<html><body><div id="root"></div><script src="/app.js"></script></body></html>') });
  const response = await api.START(post({ url: 'https://spa.example-course.com/' }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /붙여 넣어/);
  assert.deepEqual(writes, []);
});

test('the daily limit is reported as a limit', async () => {
  const { api } = stub({ insert: () => Response.json({ code: 'P0001', message: 'IMPORT_LIMIT' }, { status: 400 }), fetchPage: page('<body>' + '글 '.repeat(200) + '</body>') });
  const response = await api.START(post({ url: 'https://www.example-course.com/c/1' }));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /내일/);
});

test('if queueing fails but the rules found an outline, the reader still gets that', async () => {
  const { api } = stub({ insert: () => new Response('boom', { status: 500 }) });
  const response = await api.START(post({ url: 'https://www.example-course.com/c/1' }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.importId, null);
  assert.equal(body.fallback.length, 3);
});

test('a malformed request is refused before any page is fetched', async () => {
  let fetched = 0;
  const { api } = stub({ fetchPage: async () => { fetched++; throw new Error('should not run'); } });
  for (const body of [{}, { url: '' }, { url: 'x'.repeat(2001) }, { url: 'https://a.example-course.com', follow: true }])
    assert.equal((await api.START(post(body))).status, 400, JSON.stringify(body).slice(0, 40));
  assert.equal(fetched, 0);
});

const ready = {
  found: true, title: '업무 자동화 실전', kind: 'COURSE', unitLabel: '강',
  units: [{ title: '강의 소개', minutes: 21, section: false }, { title: '실습', minutes: 30, section: false }],
  plan: { dailyUnits: 6, minutesPerUnit: 25, reason: '하루 여섯 강을 권해요.' },
};

test('while the worker has it, the answer is simply pending', async () => {
  for (const status of ['QUEUED', 'RUNNING']) {
    const { api } = stub({ rows: [{ id: importId, status, result: null, error_code: null, context: {} }] });
    assert.deepEqual(await (await api.STATUS(get(), importId)).json(), { status: 'PENDING' });
  }
});

test('a finished proposal is checked again and its pace fitted to the time actually free', async () => {
  const { api } = stub({ rows: [{ id: importId, status: 'READY', result: ready, error_code: null, context: { freeMinutesByWeekday: [60, 60, 60, 60, 60, 0, 0] } }] });
  const body = await (await api.STATUS(get(), importId)).json();
  assert.equal(body.status, 'READY');
  assert.deepEqual(body.proposal.units, [{ title: '강의 소개', minutes: 21 }, { title: '실습', minutes: 30 }]);
  assert.equal(body.proposal.plan.dailyUnits, 2, 'six a day would not fit in sixty minutes');
  assert.equal(body.proposal.plan.adjusted, true);
});

test('a failure, an empty outline and a missing row each say so without detail', async () => {
  const failed = stub({ rows: [{ id: importId, status: 'FAILED', result: null, error_code: 'PROVIDER_ERROR', context: {} }] });
  assert.deepEqual(await (await failed.api.STATUS(get(), importId)).json(), { status: 'FAILED' });
  const empty = stub({ rows: [{ id: importId, status: 'READY', result: { ...ready, found: false, units: [] }, error_code: null, context: {} }] });
  assert.deepEqual(await (await empty.api.STATUS(get(), importId)).json(), { status: 'NOT_FOUND' });
  const missing = stub({ rows: [] });
  assert.equal((await missing.api.STATUS(get(), importId)).status, 404);
  assert.equal((await missing.api.STATUS(get(), 'not-a-uuid')).status, 400);
});
