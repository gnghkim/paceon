import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ManualProvider, GoogleBooksProvider, YES24Provider, validateBook, toBookResource } from '../packages/books/src/index.ts';
import { scheduleBook } from '../packages/scheduler/src/index.ts';

const draft = { title: '  Reading  ', authors: [' Author '], totalPages: 100, currentPage: 20, isbn: '978-0-306-40615-7' };

test('manual metadata is normalized and mapped without trusting ownership', () => {
  const book = validateBook({ ...draft, user_id: 'forged' });
  assert.equal(book.title, 'Reading');
  assert.equal(book.isbn, '9780306406157');
  const row = toBookResource(book, 'real-owner');
  assert.equal(row.user_id, 'real-owner');
  assert.equal(row.initial_completed_workload, 20);
  assert.equal(row.author, 'Author');
  assert.equal(row.source, 'MANUAL');
});

for (const bad of [{ title: ' ' }, { totalPages: 0 }, { totalPages: 1.5 }, { currentPage: 101 }, { currentPage: -1 }, { isbn: '9780306406158' }, { coverUrl: 'javascript:alert(1)' }, { authors: 'Author' }, { source: 'YES24' }, { source: 'GOOGLE_BOOKS' }]) {
  test(`reject invalid registration ${JSON.stringify(bad)}`, () => assert.throws(() => validateBook({ ...draft, ...bad })));
}

test('optional ISBN and already completed books are supported', () => {
  const book = validateBook({ title: 'Book', totalPages: 10, currentPage: 10, isbn: '' });
  assert.equal(book.isbn, undefined);
  assert.equal(toBookResource(book, 'owner').status, 'COMPLETED');
  assert.equal(validateBook({ ...draft, isbn: '0-306-40615-2' }).isbn, '0306406152');
});

test('Google adapter encodes ISBN query and normalizes incomplete metadata', async () => {
  const provider = new GoogleBooksProvider({ fetch: async url => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://www.googleapis.com');
    assert.equal(parsed.searchParams.get('q'), 'isbn:9780306406157');
    return Response.json({ totalItems: 2, items: [
      { id: 'abc', volumeInfo: { title: 'Book', authors: ['A'], industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780306406157' }], imageLinks: { thumbnail: 'http://books.google.com/image?id=abc' } } },
      { id: 'bad', volumeInfo: {} },
    ] });
  }});
  const result = await provider.search('978-0-306-40615-7');
  assert.equal(result.status, 'ok');
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].pageCount, undefined);
  assert.equal(result.books[0].thumbnail, 'https://books.google.com/image?id=abc');
});

for (const response of [() => new Response('', { status: 429 }), () => new Response('invalid json'), () => Response.json({ unexpected: true }), () => { throw new Error('private upstream detail'); }]) {
  test('provider failure preserves manual registration and scheduling', async () => {
    const result = await new GoogleBooksProvider({ fetch: async () => response() }).search('Book');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.manualEntryAvailable, true);
    const book = new ManualProvider().normalize(draft);
    const plan = scheduleBook({ totalPages: book.totalPages, completedThroughPage: book.currentPage, startDate: '2026-09-14', timezone: 'Asia/Seoul', mode: 'PACE', dailyPages: 20, minutesPerPage: 1, availability: Array.from({ length: 7 }, (_, i) => ({ isoWeekday: i + 1, availableMinutes: 60 })) });
    assert.equal(plan.status, 'ok');
    assert.equal(plan.sessions[0].startPage, 21);
  });
}

test('YES24 explicitly reports unsupported and search bounds are validated', async () => {
  assert.equal((await new YES24Provider().search('Book')).status, 'unsupported');
  const google = new GoogleBooksProvider({ fetch: async () => { throw Error('must not fetch'); } });
  await assert.rejects(() => google.search(' '));
  await assert.rejects(() => google.search('Book', { maxResults: 41 }));
});

test('Google empty pages, including pages beyond the results, are successful', async () => {
  for (const totalItems of [0, 2]) {
    const result = await new GoogleBooksProvider({ fetch: async () => Response.json({ totalItems }) }).search('Book', { startIndex: 20 });
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.books, []);
  }
});

test('Google requests are cancellable and do not follow redirects', async () => {
  const result = await new GoogleBooksProvider({ fetch: async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.redirect, 'error');
    throw new DOMException('Timed out', 'TimeoutError');
  }}).search('Book');
  assert.equal(result.status, 'unavailable');
});

test('bad optional Google ISBN and image do not discard a usable book', async () => {
  const result = await new GoogleBooksProvider({ fetch: async () => Response.json({ totalItems: 1, items: [{ id: 'safe', volumeInfo: { title: 'Book', pageCount: -1, industryIdentifiers: [{ type: 'ISBN_13', identifier: 'bad' }], imageLinks: { thumbnail: 'javascript:alert(1)' } } }] }) }).search('Book');
  assert.equal(result.status, 'ok');
  assert.equal(result.books.length, 1);
  assert.equal(result.books[0].isbn, undefined);
  assert.equal(result.books[0].thumbnail, undefined);
  assert.equal(result.books[0].pageCount, undefined);
});
