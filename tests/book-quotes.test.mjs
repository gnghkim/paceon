import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_QUOTE_LENGTH,
  normalizeQuoteText,
  sortQuotes,
  suggestQuotePage,
  validQuotePage,
} from '../apps/web/src/lib/book-quotes.ts';
import { createQuoteHandlers } from '../apps/web/src/lib/book-quotes-api.ts';

test('a quote keeps its lines and loses only the mess around them', () => {
  assert.equal(normalizeQuoteText('  생각은 외주 줄 수 없다.  '), '생각은 외주 줄 수 없다.');
  assert.equal(normalizeQuoteText('첫 줄\n둘째 줄'), '첫 줄\n둘째 줄', 'a poem keeps its lines');
  assert.equal(normalizeQuoteText('가\r\n\r\n\r\n나'), '가\n\n나');
  assert.equal(normalizeQuoteText('여러   칸\t띄움'), '여러 칸 띄움');
  for (const raw of ['', '   ', '\n\t\n']) assert.equal(normalizeQuoteText(raw), null, JSON.stringify(raw));
});

test('an overlong quote is refused rather than cut', () => {
  assert.equal(normalizeQuoteText('가'.repeat(MAX_QUOTE_LENGTH))?.length, MAX_QUOTE_LENGTH);
  assert.equal(normalizeQuoteText('가'.repeat(MAX_QUOTE_LENGTH + 1)), null);
});

test('a page must be a whole page inside the book', () => {
  assert.ok(validQuotePage(1, 300));
  assert.ok(validQuotePage(300, 300));
  for (const page of [0, -1, 301, 1.5, '12', Number.NaN, undefined]) assert.equal(validQuotePage(page, 300), false, String(page));
  assert.ok(validQuotePage(5000, null), 'a book without a page count only checks the lower bound');
});

test('quotes read in the order of the book, earlier ones first on the same page', () => {
  const quotes = [
    { id: 'c', page: 120, createdOn: '2026-10-02' },
    { id: 'a', page: 30, createdOn: '2026-10-05' },
    { id: 'b', page: 120, createdOn: '2026-10-01' },
  ];
  assert.deepEqual(sortQuotes(quotes).map((q) => q.id), ['a', 'b', 'c']);
});

test('the page field starts where the reader probably is', () => {
  const reading = { lastPage: 120, totalPages: 300, todayEnd: 140, finished: false };
  assert.equal(suggestQuotePage(reading, undefined), 121, 'the page after the last one read');
  assert.equal(suggestQuotePage(reading, 133), 133, 'the page just quoted, for the next sentence on it');
  assert.equal(suggestQuotePage({ ...reading, lastPage: 0 }, undefined), 1);
  assert.equal(suggestQuotePage({ ...reading, lastPage: 300, finished: true }, undefined), null, 'a re-read could be anywhere');
  assert.equal(suggestQuotePage(null, undefined), null);
});

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const bookId = '22345678-1234-4234-9234-123456789abc';
const quoteId = '32345678-1234-4234-9234-123456789abc';
const book = { id: bookId, user_id: user, title: '사고외주', workload_unit: 'PAGE', total_pages: 300 };
const row = (extra = {}) => ({
  id: quoteId, user_id: user, resource_id: bookId, page: 121, content: '생각은 외주 줄 수 없다.',
  note: null, created_at: '2026-10-09T01:00:00Z', updated_at: '2026-10-09T01:00:00Z', ...extra,
});

function stub({ books = [book], quotes = [row()], written = (body) => [row(body)] } = {}) {
  const calls = [];
  const api = createQuoteHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    const path = target.pathname;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, query: Object.fromEntries(target.searchParams), body });
    if (path.endsWith('/user')) return Response.json({ id: user });
    if (path === '/rest/v1/resources') {
      const wanted = target.searchParams.get('id')?.slice(3);
      return Response.json(books.filter((b) => b.id === wanted));
    }
    if (path === '/rest/v1/book_quotes') return Response.json(method === 'GET' ? quotes : written(body));
    return Response.json([]);
  });
  return { api, calls };
}

const request = (method, body) =>
  new Request(`http://localhost/api/resources/books/${bookId}/quotes`, {
    method,
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

test('a quote is saved with its page, cleaned, and the note left out when blank', async () => {
  const { api, calls } = stub();
  const response = await api.CREATE(request('POST', { page: 121, content: '  생각은 외주\n\n\n줄 수 없다.  ', note: '   ' }), bookId);
  assert.equal(response.status, 201);
  const write = calls.find((c) => c.path === '/rest/v1/book_quotes' && c.method === 'POST');
  assert.deepEqual(write.body, { user_id: user, resource_id: bookId, page: 121, content: '생각은 외주\n\n줄 수 없다.', note: null });
  const { quote } = await response.json();
  assert.deepEqual(Object.keys(quote).sort(), ['content', 'createdOn', 'id', 'note', 'page'], 'nothing more than the screen needs');
});

test('a quote outside the book, empty, or on a book that is not the reader\'s is refused before writing', async () => {
  for (const [body, status, pattern] of [
    [{ page: 301, content: 'x' }, 400, /1에서 300/],
    [{ page: 0, content: 'x' }, 400, /1에서 300/],
    [{ page: 5, content: '   ' }, 400, /남길 문장/],
    [{ page: 5, content: '가'.repeat(MAX_QUOTE_LENGTH + 1) }, 400, /2000자/],
    [{ page: 5, content: 'x', title: 'extra' }, 400, /쪽과 문장/],
  ]) {
    const { api, calls } = stub();
    const response = await api.CREATE(request('POST', body), bookId);
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 60));
    assert.match((await response.json()).error, pattern);
    assert.equal(calls.some((c) => c.path === '/rest/v1/book_quotes'), false, 'nothing is written');
  }
  const elsewhere = stub({ books: [] });
  assert.equal((await elsewhere.api.CREATE(request('POST', { page: 1, content: 'x' }), bookId)).status, 404);
  const course = stub({ books: [{ ...book, workload_unit: 'UNIT' }] });
  assert.equal((await course.api.CREATE(request('POST', { page: 1, content: 'x' }), bookId)).status, 404, 'a material without pages');
});

test('the list asks for this book in page order', async () => {
  const { api, calls } = stub({ quotes: [row(), row({ id: '42345678-1234-4234-9234-123456789abc', page: 140, note: '좋다' })] });
  const body = await (await api.LIST(request('GET'), bookId)).json();
  assert.deepEqual(body.quotes.map((q) => [q.page, q.note]), [[121, null], [140, '좋다']]);
  const query = calls.find((c) => c.path === '/rest/v1/book_quotes').query;
  assert.equal(query.resource_id, `eq.${bookId}`);
  assert.equal(query.user_id, `eq.${user}`);
  assert.equal(query.order, 'page.asc,created_at.asc,id.asc');
});

test('a correction changes only what was sent, and only the reader\'s own quote', async () => {
  const { api, calls } = stub();
  const response = await api.UPDATE(request('PATCH', { note: '' }), bookId, quoteId);
  assert.equal(response.status, 200);
  const write = calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(write.body, { note: null }, 'clearing the note removes it');
  assert.equal(write.query.id, `eq.${quoteId}`);
  assert.equal(write.query.resource_id, `eq.${bookId}`);
  assert.equal(write.query.user_id, `eq.${user}`);
  assert.equal((await stub().api.UPDATE(request('PATCH', {}), bookId, quoteId)).status, 400, 'an empty change is refused');
  assert.equal((await stub().api.UPDATE(request('PATCH', { page: 999 }), bookId, quoteId)).status, 400);
  const missing = stub({ written: () => [] });
  assert.equal((await missing.api.UPDATE(request('PATCH', { content: 'y' }), bookId, quoteId)).status, 404);
});

test('removing says so only when a quote was really removed', async () => {
  const { api, calls } = stub();
  assert.deepEqual(await (await api.REMOVE(request('DELETE'), bookId, quoteId)).json(), { removed: true });
  assert.equal(calls.find((c) => c.method === 'DELETE').query.user_id, `eq.${user}`);
  const gone = stub({ written: () => [] });
  assert.equal((await gone.api.REMOVE(request('DELETE'), bookId, quoteId)).status, 404);
  assert.equal((await gone.api.REMOVE(request('DELETE'), bookId, 'not-a-uuid')).status, 400);
});

test('nothing is served without a signed-in reader', async () => {
  const { api } = stub();
  const anonymous = new Request(`http://localhost/api/resources/books/${bookId}/quotes`);
  assert.equal((await api.LIST(anonymous, bookId)).status, 401);
});
