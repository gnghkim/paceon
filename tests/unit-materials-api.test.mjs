import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUnitMaterialHandlers } from '../apps/web/src/lib/unit-materials-api.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const materialId = '32345678-1234-4234-9234-123456789abc';
const unitId = '52345678-1234-4234-9234-123456789abc';

/** rpc 응답을 정해 주는 가짜 서버. 부른 함수와 넘긴 값을 기록한다. */
function stub(answers = {}) {
  const calls = [];
  const api = createUnitMaterialHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (path.startsWith('/rest/v1/rpc/')) {
      const name = path.slice('/rest/v1/rpc/'.length);
      calls.push({ name, body: JSON.parse(init.body) });
      const answer = answers[name];
      if (answer instanceof Response) return answer;
      return Response.json(answer ?? null);
    }
    if (path === '/rest/v1/learner_profiles')
      return Response.json([{ user_id: user, timezone: 'Asia/Seoul', daily_learning_minutes: null }]);
    return Response.json([]);
  });
  return { api, calls };
}
const post = (path, body) =>
  new Request(`http://localhost/api/resources/materials${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const problem = (code, message, status = 400) => Response.json({ code, message }, { status });

const textbook = { title: 'Basic Grammar in Use', kind: 'TEXTBOOK', unitLabel: 'Unit', units: [{ title: 'Unit 1' }, { title: 'Unit 2', minutes: 30 }] };

test('a material and its chapters go to the database in one call', async () => {
  const { api, calls } = stub({ create_unit_material: materialId });
  const response = await api.CREATE(post('', { ...textbook, units: [{ title: 'Part 1', section: true }, ...textbook.units] }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { id: materialId });
  assert.equal(calls[0].name, 'create_unit_material');
  assert.deepEqual(calls[0].body.p_input.units[0], { title: 'Part 1', section: true });
});

test('an outline that cannot be studied is refused before the database is asked', async () => {
  for (const body of [
    { ...textbook, units: [] },
    { ...textbook, units: [{ title: 'only a heading', section: true }] },
    { ...textbook, kind: 'NOVEL' },
    { ...textbook, unitLabel: '' },
    { ...textbook, units: [{ title: 'a', minutes: 0 }] },
    { ...textbook, units: [{ title: 'a', minutes: 12.5 }] },
    { ...textbook, sourceUrl: 'not a url' },
    { ...textbook, owner: 'someone else' },
  ]) {
    const { api, calls } = stub();
    assert.equal((await api.CREATE(post('', body))).status, 400, JSON.stringify(body).slice(0, 70));
    assert.deepEqual(calls, []);
  }
});

test('the plan is made in the reader\'s own timezone', async () => {
  const { api, calls } = stub({ plan_unit_material: { status: 'ok' } });
  const response = await api.PLAN(post(`/${materialId}/plan`, { dailyUnits: 2, minutesPerUnit: 25 }), materialId);
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].body, { p_resource_id: materialId, p_options: { dailyUnits: 2, minutesPerUnit: 25, timezone: 'Asia/Seoul' } });
});

test('a plan that cannot be filled says why, in words', async () => {
  const none = stub({ plan_unit_material: problem('P0001', 'UNIT_PLAN_CONFLICT:NO_AVAILABILITY') });
  const first = await none.api.PLAN(post(`/${materialId}/plan`, { dailyUnits: 2, minutesPerUnit: 25 }), materialId);
  assert.equal(first.status, 409);
  assert.match((await first.json()).error, /학습할 수 있는 시간이 없어요/);
  const full = stub({ plan_unit_material: problem('P0001', 'UNIT_PLAN_CONFLICT:TIME_CAPACITY') });
  const second = await full.api.PLAN(post(`/${materialId}/plan`, { dailyUnits: 2, minutesPerUnit: 25 }), materialId);
  assert.match((await second.json()).error, /가득 차/);
});

test('studying a chapter passes only what was given', async () => {
  const { api, calls } = stub({ submit_unit_progress: { done: 1, total: 115 } });
  const key = '72345678-1234-4234-9234-123456789abc';
  await api.PROGRESS(post(`/${materialId}/progress`, { kind: 'COMPLETE', unitId, idempotencyKey: key, memo: '  과거형  ', durationMinutes: 28 }), materialId);
  assert.deepEqual(calls[0].body.p_request, { kind: 'COMPLETE', unitId, idempotencyKey: key, durationMinutes: 28, memo: '과거형' });
  await api.PROGRESS(post(`/${materialId}/progress`, { kind: 'COMPLETE', unitId, idempotencyKey: key, memo: '   ' }), materialId);
  assert.deepEqual(calls[1].body.p_request, { kind: 'COMPLETE', unitId, idempotencyKey: key }, 'an empty note and no time are left out');
});

test('undoing takes no note and no time', async () => {
  const { api, calls } = stub();
  const key = '72345678-1234-4234-9234-123456789abc';
  const response = await api.PROGRESS(post(`/${materialId}/progress`, { kind: 'UNDO', unitId, idempotencyKey: key, memo: '이유' }), materialId);
  assert.equal(response.status, 400);
  assert.deepEqual(calls, []);
});

test('database refusals become messages a reader can act on', async () => {
  const key = '72345678-1234-4234-9234-123456789abc';
  const request = () => post(`/${materialId}/progress`, { kind: 'COMPLETE', unitId, idempotencyKey: key });
  for (const [answer, status, words] of [
    [problem('23505', 'Unit already completed', 409), 409, /이미 완료/],
    [problem('23514', 'Unit not completed yet'), 409, /아직 공부하지 않은/],
    [problem('23514', 'Material is archived'), 409, /보관한 자료/],
    [problem('42501', 'Unit not found', 403), 401, /로그인/],
    [problem('P0002', 'Plan not found', 404), 404, /계획을 만들어/],
    [problem('XX000', 'boom', 500), 503, /다시 시도/],
  ]) {
    const { api } = stub({ submit_unit_progress: answer });
    const response = await api.PROGRESS(request(), materialId);
    assert.equal(response.status, status, answer.status);
    assert.match((await response.json()).error, words);
  }
});

test('a malformed id never reaches the database', async () => {
  const { api, calls } = stub();
  assert.equal((await api.REPLAN(post('/x/replan', {}), 'not-a-uuid')).status, 400);
  assert.equal((await api.PLAN(post('/x/plan', { dailyUnits: 1, minutesPerUnit: 10 }), 'not-a-uuid')).status, 400);
  assert.deepEqual(calls, []);
});
