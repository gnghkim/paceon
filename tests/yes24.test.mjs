import assert from 'node:assert/strict';
import { test } from 'node:test';
import { YES24Provider, validateBook, toBookResource } from '../packages/books/src/index.ts';

const item = { itemId: 12345678, title: '클린 코드', author: 'Robert Martin', publisher: 'Insight', isbn13: '9780306406157', pages: 584, cover: 'https://image.yes24.com/goods/12345678/L', publishDate: '2013-12-24', contentDetail: { bookIntroduction: 'Introduction', tableOfContents: 'Chapter 1' } };
const envelope = (items = [item], extra = {}) => ({ success: true, data: { items, totalCount: items.length, currentPage: 1, pageSize: 10, ...extra } });
const provider = fetch => new YES24Provider({ apiKey: 'private-key', fetch });

test('YES24 official request and metadata can be registered with provenance', async () => {
  const result = await provider(async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, 'https://apis.yes24.com/v1/goods/itemList');
    assert.deepEqual(Object.fromEntries(parsed.searchParams), { query: '클린 코드', category: 'BOOK', detail: 'Y', page: '1', pageSize: '10' });
    assert.equal(new Headers(options.headers).get('X-Api-Key'), 'private-key');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!String(url).includes('private-key'));
    return Response.json(envelope());
  }).search(' 클린 코드 ');
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.books[0], { title: item.title, authors: [item.author], source: 'YES24', sourceId: '12345678', isbn: item.isbn13, publisher: item.publisher, pageCount: 584, thumbnail: item.cover, publishedDate: item.publishDate, description: 'Introduction', tableOfContents: 'Chapter 1' });
  const book = validateBook({ ...result.books[0], totalPages: 584 });
  assert.equal(toBookResource(book, 'owner').source_id, '12345678');
});

test('YES24 missing credentials do not send a request', async () => {
  let called = false;
  assert.equal((await new YES24Provider({ fetch: async () => { called = true; throw Error(); } }).search('Book')).status, 'unavailable');
  assert.equal(called, false);
});

test('YES24 validates query, pagination and registration IDs', async () => {
  const p = provider(async () => { throw Error('must not fetch'); });
  for (const [query, options] of [[' ', {}], ['x'.repeat(201), {}], ['Book', { startIndex: -1 }], ['Book', { startIndex: 1001 }], ['Book', { startIndex: 1.5 }], ['Book', { maxResults: 0 }], ['Book', { maxResults: 41 }]]) await assert.rejects(() => p.search(query, options));
  for (const sourceId of [undefined, '0', '-1', '1.2', 'abc', '01']) assert.throws(() => validateBook({ title: 'Book', totalPages: 1, source: 'YES24', sourceId }));
});

test('YES24 offsets span at most two pages and slice before skipping malformed items', async () => {
  const pages = [];
  const result = await provider(async url => {
    const params = new URL(url).searchParams;
    const page = Number(params.get('page'));
    pages.push(page);
    const items = Array.from({ length: 10 }, (_, i) => ({ itemId: (page - 1) * 10 + i + 1, title: `Book ${(page - 1) * 10 + i}` }));
    if (page === 2) items[6] = { title: 'bad' };
    return Response.json(envelope(items, { totalCount: 50, currentPage: page }));
  }).search('Book', { startIndex: 15, maxResults: 10 });
  assert.deepEqual(pages, [2, 3]);
  assert.deepEqual(result.books.map(b => b.sourceId), ['16', '18', '19', '20', '21', '22', '23', '24', '25']);
  assert.equal(result.totalItems, 50);
});

test('YES24 drops malformed optional metadata without inventing pages', async () => {
  const result = await provider(async () => Response.json(envelope([{ ...item, pages: -1, isbn13: 'bad', isbn10: '0306406152', cover: 'javascript:alert(1)', author: {}, publisher: {}, contentDetail: null }, { itemId: -1, title: 'bad' }, { itemId: 3, title: '' }]))).search('Book');
  assert.equal(result.status, 'ok');
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].pageCount, undefined);
  assert.equal(result.books[0].thumbnail, undefined);
  assert.equal(result.books[0].isbn, '0306406152');
  assert.deepEqual(result.books[0].authors, []);
});

test('YES24 only documented 404 SEARCH_001 is an empty success', async () => {
  const result = await provider(async () => Response.json({ success: false, errorCode: 'SEARCH_001' }, { status: 404 })).search('Book');
  assert.deepEqual(result, { status: 'ok', books: [], totalItems: 0, manualEntryAvailable: true });
});

for (const response of [
  () => Response.json({ success: false, errorCode: 'AUTH_002', message: 'private-key' }, { status: 401 }),
  () => Response.json({ errorCode: 'SEARCH_001' }, { status: 500 }),
  () => Response.json({ errorCode: 'OTHER' }, { status: 404 }),
  () => new Response('bad JSON'),
  () => Response.json({ success: false }),
  () => Response.json(envelope([], { totalCount: -1 })),
  () => Response.json(envelope([], { currentPage: 2 })),
  () => Response.json(envelope([], { pageSize: 20 })),
  () => Response.json({ success: true, data: { totalCount: 0 } }),
  () => Response.json({ ...envelope(), message: 'x'.repeat(2 * 1024 * 1024) }),
  () => { throw new DOMException('private-key', 'TimeoutError'); },
]) test('YES24 upstream failure is safe and preserves manual entry', async () => {
  assert.deepEqual(await provider(async () => response()).search('Book'), { status: 'unavailable', books: [], manualEntryAvailable: true });
});
