import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createExpressionHandlers } from '../apps/web/src/lib/expressions-api.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const cardId = '22345678-1234-4234-9234-123456789abc';

const request = (method, body) =>
  new Request('http://localhost/api/learning/expressions', {
    method,
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
const get = (query = '') =>
  new Request(`http://localhost/api/learning/expressions${query}`, {
    headers: { authorization: 'Bearer token' },
  });

const row = (id, due_on, extra = {}) => ({
  id,
  user_id: user,
  phrase: `phrase ${id}`,
  meaning: `meaning ${id}`,
  example: null,
  examples: [],
  lookup_status: 'NONE',
  lookup_attempts: 0,
  lease_token: null,
  lease_expires_at: null,
  source_workspace_id: null,
  review_step: 0,
  due_on,
  last_reviewed_on: null,
  review_count: 0,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
});

/** Serves one account with a fixed timezone and records every write. */
function stub({ rows = [], onWrite = () => null } = {}) {
  const writes = [];
  const api = createExpressionHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (init.method && init.method !== 'GET') {
      const body = init.body ? JSON.parse(init.body) : null;
      writes.push({ path, method: init.method, body, query: Object.fromEntries(target.searchParams) });
      const answer = onWrite({ path, body });
      if (answer) return answer;
      return new Response('', { status: 200 });
    }
    if (path === '/rest/v1/learning_expressions') {
      const filter = target.searchParams.get('id');
      const wanted = filter ? filter.slice('eq.'.length) : null;
      return Response.json(wanted ? rows.filter((r) => r.id === wanted) : rows);
    }
    if (path === '/rest/v1/learner_profiles')
      return Response.json([{ user_id: user, timezone: 'Asia/Seoul', daily_learning_minutes: null }]);
    return Response.json([]);
  });
  return { api, writes };
}

test('today shows at most three cards and never counts the backlog', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`${i}2345678-1234-4234-9234-123456789abc`, '2026-01-01'));
  const { api } = stub({ rows });
  const body = await (await api.GET(get())).json();
  assert.equal(body.cards.length, 3);
  assert.equal(body.due, 3, 'due is the size of one sitting, not the backlog');
  assert.equal(body.saved, 12);
});

test('a card due later is not offered today', async () => {
  const { api } = stub({ rows: [row(cardId, '2099-01-01')] });
  const body = await (await api.GET(get())).json();
  assert.deepEqual(body.cards, []);
  assert.equal(body.due, 0);
  assert.equal(body.saved, 1);
});

test('the wordbook lists everything, newest due first', async () => {
  const rows = [row('a2345678-1234-4234-9234-123456789abc', '2099-01-01'), row(cardId, '2026-01-01')];
  const { api } = stub({ rows });
  const body = await (await api.GET(get('?all=true'))).json();
  assert.deepEqual(body.cards.map((c) => c.due_on), ['2099-01-01', '2026-01-01']);
});

test('a word still waiting on its meaning is listed but never asked about', async () => {
  const waiting = row(cardId, '2026-01-01', { meaning: null, lookup_status: 'QUEUED' });
  const { api } = stub({ rows: [waiting] });
  const body = await (await api.GET(get())).json();
  assert.equal(body.saved, 1);
  assert.equal(body.pending, 1);
  assert.equal(body.due, 0, 'there is no meaning to ask for yet');
  assert.deepEqual(body.cards, []);
  const all = await (await api.GET(get('?all=true'))).json();
  assert.equal(all.cards[0].lookup, 'PENDING');
  assert.equal(all.cards[0].meaning, '');
});

test('a lookup that gave up is listed as failed so the learner can fill it in', async () => {
  const { api } = stub({ rows: [row(cardId, '2026-01-01', { meaning: null, lookup_status: 'FAILED' })] });
  const all = await (await api.GET(get('?all=true'))).json();
  assert.equal(all.cards[0].lookup, 'FAILED');
  assert.equal((await (await api.GET(get())).json()).due, 0);
});

test('a word saved with no meaning is queued for the lookup', async () => {
  const { api, writes } = stub({
    onWrite: ({ path, body }) =>
      path === '/rest/v1/learning_expressions' ? Response.json([row(cardId, body.due_on)]) : null,
  });
  const response = await api.POST(request('POST', { phrase: 'serendipity' }));
  assert.equal(response.status, 201);
  const written = writes[0].body;
  assert.equal(written.lookup_status, 'QUEUED');
  assert.equal(written.meaning, null);
  assert.deepEqual(written.examples, []);
});

test('a word saved with a meaning is settled at once and never queued', async () => {
  const { api, writes } = stub({
    onWrite: ({ path, body }) =>
      path === '/rest/v1/learning_expressions' ? Response.json([row(cardId, body.due_on)]) : null,
  });
  await api.POST(request('POST', { phrase: 'put off', meaning: '미루다' }));
  assert.equal(writes[0].body.lookup_status, 'NONE');
  assert.equal(writes[0].body.meaning, '미루다');
});

test('a meaning of only spaces counts as not given', async () => {
  const { api, writes } = stub({
    onWrite: ({ path, body }) =>
      path === '/rest/v1/learning_expressions' ? Response.json([row(cardId, body.due_on)]) : null,
  });
  await api.POST(request('POST', { phrase: 'tune out', meaning: '   ' }));
  assert.equal(writes[0].body.lookup_status, 'QUEUED');
  assert.equal(writes[0].body.meaning, null);
});

test('a card never carries its source or timestamps to the browser', async () => {
  const { api } = stub({ rows: [row(cardId, '2026-01-01', { source_workspace_id: user })] });
  const body = await (await api.GET(get())).json();
  assert.deepEqual(Object.keys(body.cards[0]).sort(), ['due_on', 'examples', 'id', 'lookup', 'meaning', 'phrase', 'review_step']);
});

test('saving an expression schedules it for tomorrow rather than today', async () => {
  const { api, writes } = stub({
    onWrite: ({ path, body }) =>
      path === '/rest/v1/learning_expressions' ? Response.json([row(cardId, body.due_on)]) : null,
  });
  const response = await api.POST(request('POST', { phrase: 'get around to', meaning: '드디어 ~하다' }));
  assert.equal(response.status, 201);
  const written = writes[0].body;
  assert.equal(written.phrase, 'get around to');
  assert.equal(written.review_step, 0);
  assert.equal(written.user_id, user);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  assert.ok(written.due_on > today, 'the first review comes after the day it was saved');
});

test('an expression already saved is reported, not merged or duplicated', async () => {
  const { api } = stub({
    onWrite: ({ path }) =>
      path === '/rest/v1/learning_expressions' ? new Response('duplicate key', { status: 409 }) : null,
  });
  const response = await api.POST(request('POST', { phrase: 'get around to', meaning: '드디어 ~하다' }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.duplicate, true);
  assert.match(body.error, /이미 저장한/);
});

test('an empty or overlong phrase never reaches the database', async () => {
  const { api, writes } = stub();
  for (const bad of [
    { phrase: '' },
    { phrase: '   ' },
    { phrase: 'x'.repeat(201) },
    { phrase: 'x', meaning: 'y'.repeat(501) },
    { phrase: 'x', meaning: 'y', unknown: 1 },
    {},
  ])
    assert.equal((await api.POST(request('POST', bad))).status, 400);
  assert.deepEqual(writes, []);
});

test('grading moves the card and records the day it was answered', async () => {
  const { api, writes } = stub({
    rows: [row(cardId, '2026-01-01', { review_step: 1 })],
    onWrite: ({ path, body }) =>
      path.endsWith('record_expression_review') ? Response.json(row(cardId, body.p_due_on, { review_step: body.p_step })) : null,
  });
  const response = await api.PATCH(request('PATCH', { id: cardId, grade: 'EASY' }));
  assert.equal(response.status, 200);
  const call = writes.find((w) => w.path.endsWith('record_expression_review'));
  assert.equal(call.body.p_step, 2, 'easy moves to the next interval');
  assert.equal(call.body.p_id, cardId);
  assert.ok(call.body.p_due_on > call.body.p_today);
});

test('a hard answer brings the card back to the first interval', async () => {
  const { api, writes } = stub({
    rows: [row(cardId, '2026-01-01', { review_step: 4 })],
    onWrite: ({ path, body }) =>
      path.endsWith('record_expression_review') ? Response.json(row(cardId, body.p_due_on)) : null,
  });
  await api.PATCH(request('PATCH', { id: cardId, grade: 'HARD' }));
  const call = writes.find((w) => w.path.endsWith('record_expression_review'));
  assert.equal(call.body.p_step, 0);
});

test('grading a card that is not yours is a not-found, and a bad grade never writes', async () => {
  const { api, writes } = stub({ rows: [] });
  assert.equal((await api.PATCH(request('PATCH', { id: cardId, grade: 'OK' }))).status, 404);
  for (const bad of [{ id: cardId, grade: 'PERFECT' }, { id: 'nope', grade: 'OK' }, { grade: 'OK' }])
    assert.equal((await api.PATCH(request('PATCH', bad))).status, 400);
  assert.deepEqual(writes, []);
});

test('deleting is scoped to the signed-in learner', async () => {
  const { api, writes } = stub();
  assert.equal((await api.DELETE(request('DELETE', { id: cardId }))).status, 200);
  assert.equal(writes[0].method, 'DELETE');
  assert.equal(writes[0].query.id, `eq.${cardId}`);
  assert.equal(writes[0].query.user_id, `eq.${user}`);
});
