import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTelegramHandlers } from '../apps/web/src/lib/telegram-api.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const turnId = '62345678-1234-4234-9234-123456789abc';

const request = (method, path = '/api/telegram/link') =>
  new Request(`http://localhost${path}`, { method, headers: { authorization: 'Bearer token' } });

function stub({ link = null, rpc = {}, turns = [], cards = [], bot = 'paceon_tutor_bot' } = {}) {
  const calls = [];
  const api = createTelegramHandlers(config, bot, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    calls.push({ path, method: init.method ?? 'GET', query: Object.fromEntries(target.searchParams), headers: init.headers });
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (path.startsWith('/rest/v1/rpc/')) {
      const answer = rpc[path.slice('/rest/v1/rpc/'.length)];
      return typeof answer === 'function' ? answer() : Response.json(answer ?? null);
    }
    if (path === '/rest/v1/telegram_links') return Response.json(link ? [link] : []);
    if (path === '/rest/v1/telegram_turns') return Response.json(turns);
    if (path === '/rest/v1/learning_expressions') return Response.json(cards);
    if (path === '/rest/v1/learner_profiles') return Response.json([{ user_id: user, timezone: 'Asia/Seoul' }]);
    return Response.json([]);
  });
  return { api, calls };
}

test('the link status says whether the reader is linked, and where the bot is', async () => {
  const off = await (await stub().api.STATUS(request('GET'))).json();
  assert.deepEqual(off, { linked: false, botUsername: 'paceon_tutor_bot' });
  const on = await (await stub({ link: { user_id: user, linked_at: '2026-10-05T01:00:00Z', level: 'ADVANCED', voice_replies: true, review_at: '08:30:00', telegram_user_id: 555, chat_id: 555 } }).api.STATUS(request('GET'))).json();
  assert.deepEqual(on, { linked: true, botUsername: 'paceon_tutor_bot', linkedAt: '2026-10-05T01:00:00Z', level: 'ADVANCED', voiceReplies: true, reviewAt: '08:30' });
  assert.equal(JSON.stringify(on).includes('555'), false, 'Telegram identities stay on the server');
});

test('a bot name that is not a Telegram username is never offered', async () => {
  const body = await (await stub({ bot: 'https://evil.example' }).api.STATUS(request('GET'))).json();
  assert.equal(body.botUsername, null);
});

test('a code is issued once, with its expiry and a one-tap link', async () => {
  const { api, calls } = stub({ rpc: { create_telegram_link_code: { code: 'AB12CD34', expiresAt: '2026-10-05T01:10:00Z' } } });
  const response = await api.CODE(request('POST'));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    code: 'AB12CD34',
    expiresAt: '2026-10-05T01:10:00Z',
    botUsername: 'paceon_tutor_bot',
    deepLink: 'https://t.me/paceon_tutor_bot?start=AB12CD34',
  });
  const rpc = calls.find((c) => c.path === '/rest/v1/rpc/create_telegram_link_code');
  assert.equal(rpc.method, 'POST');
  assert.equal(rpc.headers.Authorization, 'Bearer token', 'the code is made as the reader, never with a service key');
});

test('too many codes in an hour is said plainly', async () => {
  const { api } = stub({ rpc: { create_telegram_link_code: () => Response.json({ code: 'P0001', message: 'LINK_CODE_LIMIT' }, { status: 400 }) } });
  const response = await api.CODE(request('POST'));
  assert.equal(response.status, 429);
  assert.match((await response.json()).error, /한 시간/);
});

test('unlinking goes through the reader\'s own function', async () => {
  const { api, calls } = stub({ rpc: { unlink_telegram: true } });
  assert.deepEqual(await (await api.UNLINK(request('DELETE'))).json(), { unlinked: true });
  assert.ok(calls.some((c) => c.path === '/rest/v1/rpc/unlink_telegram'));
});

const turnRow = (i) => ({
  id: `${i}2345678-1234-4234-9234-123456789abc`,
  input_kind: 'TEXT',
  learner_text: `I go ${i}`,
  reply_text: 'Nice!\n\n[Feedback]\n• x',
  tutor_turn: { reply: 'Nice!', mistakes: [{ wrong: 'go', correct: 'went', rule: 'r', category: 'grammar' }], natural_version: '', tip: '' },
  mistake_count: 1,
  rewrite_attempt: false,
  rewrite_correct: null,
  created_at: `2026-10-0${i}T01:00:00Z`,
});

test('turns come newest first, a page at a time, with each mistake\'s card', async () => {
  const turns = Array.from({ length: 21 }, (_, i) => turnRow((i % 9) + 1));
  const cards = [{ wrong_text: 'go', correct_text: 'went', due_on: '2026-10-07', review_count: 2, occurrences: 3 }];
  const { api, calls } = stub({ link: { user_id: user }, turns, cards });
  const body = await (await api.TURNS(request('GET', '/api/telegram/turns?before=2026-10-05T00:00:00.000Z'))).json();
  assert.equal(body.linked, true);
  assert.equal(body.turns.length, 20, 'one page');
  assert.equal(body.nextBefore, body.turns.at(-1).createdAt, 'a 21st row means there is more');
  assert.deepEqual(body.turns[0].mistakes[0].card, { dueOn: '2026-10-07', reviewCount: 2, occurrences: 3 });
  const query = calls.find((c) => c.path === '/rest/v1/telegram_turns').query;
  assert.equal(query.order, 'created_at.desc,id.desc');
  assert.equal(query.limit, '21');
  assert.equal(query.created_at, 'lt.2026-10-05T00:00:00.000Z');
  assert.equal(query.user_id, `eq.${user}`);
  const cardQuery = calls.find((c) => c.path === '/rest/v1/learning_expressions').query;
  assert.equal(cardQuery.kind, 'eq.CORRECTION');
});

test('the last page has no next cursor, and a bad cursor never reaches the database', async () => {
  const { api } = stub({ turns: [turnRow(1)] });
  const body = await (await api.TURNS(request('GET', '/api/telegram/turns'))).json();
  assert.equal(body.nextBefore, null);
  assert.equal(body.linked, false);
  const bad = stub();
  assert.equal((await bad.api.TURNS(request('GET', '/api/telegram/turns?before=yesterday'))).status, 400);
  assert.equal(bad.calls.some((c) => c.path === '/rest/v1/telegram_turns'), false);
});

test('nothing is served without a signed-in reader', async () => {
  const { api } = stub();
  const anonymous = new Request('http://localhost/api/telegram/link');
  for (const handler of [api.STATUS, api.CODE, api.UNLINK, api.TURNS])
    assert.equal((await handler(anonymous)).status, 401);
});
