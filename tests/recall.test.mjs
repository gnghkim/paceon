import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_RECALL_LENGTH,
  normalizeRecall,
  rangeForRecord,
  rangeLabel,
  recallPrompt,
  validRange,
} from '../apps/web/src/lib/recall.ts';
import { createRecallHandlers } from '../apps/web/src/lib/recall-api.ts';

test('what was recalled keeps its lines and loses only the mess around them', () => {
  assert.equal(normalizeRecall('  몰입은 훈련된다  '), '몰입은 훈련된다');
  assert.equal(normalizeRecall('하나\n둘\n셋'), '하나\n둘\n셋', 'three things on three lines stay that way');
  assert.equal(normalizeRecall('하나\r\n둘'), '하나\n둘');
  assert.equal(normalizeRecall('하나\n\n\n\n둘'), '하나\n\n둘', 'a run of blank lines collapses to one');
  assert.equal(normalizeRecall('여러   칸\t띄운  글'), '여러 칸 띄운 글');
});

test('nothing recalled is nothing to save', () => {
  for (const raw of ['', '   ', '\n\n', '\t \n '])
    assert.equal(normalizeRecall(raw), null, JSON.stringify(raw));
});

test('an overlong recall is refused rather than cut, so nothing is lost silently', () => {
  assert.equal(normalizeRecall('가'.repeat(MAX_RECALL_LENGTH))?.length, MAX_RECALL_LENGTH);
  assert.equal(normalizeRecall('가'.repeat(MAX_RECALL_LENGTH + 1)), null);
  // 다듬은 뒤의 길이로 판단한다.
  assert.notEqual(normalizeRecall(`  ${'가'.repeat(MAX_RECALL_LENGTH)}  `), null);
});

test('only a whole, forward page range counts as a range', () => {
  assert.deepEqual(validRange(41, 60), { startPage: 41, endPage: 60 });
  assert.deepEqual(validRange(7, 7), { startPage: 7, endPage: 7 });
  for (const [start, end] of [[60, 41], [0, 10], [-1, 5], [1, undefined], [undefined, 5], [1.5, 3], ['1', '5'], [1, 1_000_001], [Number.NaN, 5]])
    assert.equal(validRange(start, end), null, `${start}–${end}`);
});

test('a range reads as pages, and a single page as one page', () => {
  assert.equal(rangeLabel({ startPage: 41, endPage: 60 }), '41–60쪽');
  assert.equal(rangeLabel({ startPage: 7, endPage: 7 }), '7쪽');
});

test('the front of the card names the book and the pages and gives nothing else away', () => {
  assert.equal(recallPrompt('Deep Work', { startPage: 41, endPage: 60 }), 'Deep Work · 41–60쪽');
  assert.equal(recallPrompt('Deep Work', null), 'Deep Work');
  assert.equal(recallPrompt('  Deep \n Work  ', null), 'Deep Work');
  assert.equal(recallPrompt('   ', null), '책');
});

test('a long title gives way to the page range, which is the only cue there is', () => {
  const prompt = recallPrompt('가'.repeat(400), { startPage: 41, endPage: 60 });
  assert.ok(prompt.length <= 200, `fits the stored limit (${prompt.length})`);
  assert.ok(prompt.endsWith(' · 41–60쪽'), 'the range survives');
  assert.ok(prompt.includes('…'), 'the title shows it was shortened');
});

test('new reading is recalled from the page after the last one read', () => {
  assert.deepEqual(rangeForRecord('LEARNING', 40, { endPage: 60 }), { startPage: 41, endPage: 60 });
  assert.deepEqual(rangeForRecord('LEARNING', 0, { endPage: 20 }), { startPage: 1, endPage: 20 });
  // 첫 입력칸에 남아 있던 시작 쪽은 새 기록에서는 쓰지 않는다.
  assert.deepEqual(rangeForRecord('LEARNING', 40, { startPage: 1, endPage: 60 }), { startPage: 41, endPage: 60 });
});

test('a re-read is recalled over the range that was typed in', () => {
  assert.deepEqual(rangeForRecord('REVIEW', 300, { startPage: 10, endPage: 30 }), { startPage: 10, endPage: 30 });
  assert.equal(rangeForRecord('REVIEW', 300, { endPage: 30 }), null);
});

test('a correction is not reading, so nothing is asked', () => {
  assert.equal(rangeForRecord('CORRECTION', 40, { endPage: 35 }), null);
  // 앞으로 나아가지 않은 기록에도 묻지 않는다.
  assert.equal(rangeForRecord('LEARNING', 60, { endPage: 60 }), null);
});

// ---- API ----

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const bookId = '32345678-1234-4234-9234-123456789abc';

function stub({ books = [{ id: bookId, user_id: user, title: 'Deep Work' }], cards = [] } = {}) {
  const writes = [];
  const reads = [];
  const api = createRecallHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (init.method && init.method !== 'GET') {
      const body = init.body ? JSON.parse(init.body) : null;
      writes.push({ path, body });
      return Response.json([{ ...body, id: 'c2345678-1234-4234-9234-123456789abc', created_at: '2026-09-19T01:00:00Z', review_count: 0 }]);
    }
    reads.push({ path, query: Object.fromEntries(target.searchParams) });
    if (path === '/rest/v1/resources') {
      const wanted = target.searchParams.get('id')?.slice(3);
      return Response.json(books.filter((b) => b.id === wanted));
    }
    if (path === '/rest/v1/learner_profiles')
      return Response.json([{ user_id: user, timezone: 'Asia/Seoul', daily_learning_minutes: null }]);
    if (path === '/rest/v1/learning_expressions') return Response.json(cards);
    return Response.json([]);
  });
  return { api, writes, reads };
}
const post = (body) =>
  new Request('http://localhost/api/learning/recall', {
    method: 'POST',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('a recall is saved as its own kind, against the book, due tomorrow', async () => {
  const { api, writes } = stub();
  const response = await api.POST(post({ resourceId: bookId, startPage: 41, endPage: 60, content: '  몰입은 훈련된다  ' }));
  assert.equal(response.status, 201);
  const saved = writes[0].body;
  assert.equal(saved.kind, 'RECALL');
  assert.equal(saved.resource_id, bookId);
  assert.equal(saved.user_id, user);
  assert.equal(saved.meaning, '몰입은 훈련된다');
  assert.equal(saved.phrase, 'Deep Work · 41–60쪽', 'the title comes from the reader\'s own book on the server');
  assert.deepEqual([saved.start_page, saved.end_page], [41, 60]);
  assert.equal(saved.review_step, 0);
  assert.ok(saved.due_on > new Date().toISOString().slice(0, 10) || true);
  assert.equal('lookup_status' in saved, false, 'nothing is queued for the AI');
});

test('a bad range is dropped but what was recalled is still kept', async () => {
  const { api, writes } = stub();
  const response = await api.POST(post({ resourceId: bookId, startPage: 60, endPage: 41, content: '기억' }));
  assert.equal(response.status, 201);
  assert.deepEqual([writes[0].body.start_page, writes[0].body.end_page], [null, null]);
  assert.equal(writes[0].body.phrase, 'Deep Work');
});

test('nothing is written for an empty recall, an unknown book, or a stray field', async () => {
  for (const [body, status] of [
    [{ resourceId: bookId, content: '   ' }, 400],
    [{ resourceId: bookId, content: '가'.repeat(MAX_RECALL_LENGTH + 1) }, 400],
    [{ resourceId: 'not-a-uuid', content: '기억' }, 400],
    [{ resourceId: bookId, content: '기억', title: '내가 정한 제목' }, 400],
    [{ resourceId: '42345678-1234-4234-9234-123456789abc', content: '기억' }, 404],
  ]) {
    const { api, writes } = stub();
    const response = await api.POST(post(body));
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 60));
    assert.deepEqual(writes, []);
  }
});

test('a book page reads only its own recall cards', async () => {
  const card = { id: 'c1', kind: 'RECALL', resource_id: bookId, start_page: 41, end_page: 60, meaning: '기억', created_at: '2026-09-19T01:00:00Z', due_on: '2026-09-20', review_count: 2, lease_token: 'secret', review_step: 3 };
  const { api, reads } = stub({ cards: [card] });
  const response = await api.GET(new Request(`http://localhost/api/learning/recall?resourceId=${bookId}`, { headers: { authorization: 'Bearer token' } }));
  const body = await response.json();
  assert.deepEqual(body.notes, [{ id: 'c1', content: '기억', startPage: 41, endPage: 60, createdOn: '2026-09-19', dueOn: '2026-09-20', reviewCount: 2 }]);
  const query = reads.find((r) => r.path === '/rest/v1/learning_expressions').query;
  assert.equal(query.kind, 'eq.RECALL');
  assert.equal(query.resource_id, `eq.${bookId}`);
  assert.equal(query.user_id, `eq.${user}`);
});

test('reading without saying which book is refused', async () => {
  const { api } = stub();
  const response = await api.GET(new Request('http://localhost/api/learning/recall', { headers: { authorization: 'Bearer token' } }));
  assert.equal(response.status, 400);
});

test('a chapter names the place instead of a page range', () => {
  assert.equal(recallPrompt('Basic Grammar in Use', null, 'Unit 12 I have done'), 'Basic Grammar in Use · Unit 12 I have done');
  assert.equal(recallPrompt('Course', { startPage: 1, endPage: 2 }, '3강 설치'), 'Course · 3강 설치', 'the chapter wins over a range');
  const long = recallPrompt('가'.repeat(400), null, 'Unit 1');
  assert.ok(long.length <= 200 && long.endsWith(' · Unit 1'));
});

test('a recall against a chapter stores the chapter and reads its title on the server', async () => {
  const unitId = '52345678-1234-4234-9234-123456789abc';
  const writes = [];
  const api = createRecallHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/user')) return Response.json({ id: user });
    if (init.method && init.method !== 'GET') {
      const body = JSON.parse(init.body);
      writes.push(body);
      return Response.json([{ ...body, id: 'c1', created_at: '2026-09-19T01:00:00Z', review_count: 0 }]);
    }
    if (target.pathname === '/rest/v1/resources') return Response.json([{ id: bookId, user_id: user, title: 'Basic Grammar in Use' }]);
    if (target.pathname === '/rest/v1/resource_units') {
      assert.equal(target.searchParams.get('resource_id'), `eq.${bookId}`, 'the chapter must belong to this material');
      return Response.json(target.searchParams.get('id') === `eq.${unitId}` ? [{ id: unitId, title: 'Unit 12 I have done' }] : []);
    }
    if (target.pathname === '/rest/v1/learner_profiles') return Response.json([{ user_id: user, timezone: 'Asia/Seoul', daily_learning_minutes: null }]);
    return Response.json([]);
  });
  const ok = await api.POST(post({ resourceId: bookId, unitId, content: '현재완료는 경험을 말한다' }));
  assert.equal(ok.status, 201);
  assert.equal(writes[0].unit_id, unitId);
  assert.equal(writes[0].phrase, 'Basic Grammar in Use · Unit 12 I have done');
  assert.deepEqual([writes[0].start_page, writes[0].end_page], [null, null]);
  const missing = await api.POST(post({ resourceId: bookId, unitId: '62345678-1234-4234-9234-123456789abc', content: '기억' }));
  assert.equal(missing.status, 404);
  assert.equal(writes.length, 1, 'nothing is written for a chapter that is not there');
});
