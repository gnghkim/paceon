import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  endsReread,
  planReadingChange,
  readingState,
  rereadStartPage,
} from '../apps/web/src/lib/reading-state.ts';
import { filterLibrary } from '../apps/web/src/lib/library-filters.ts';
import { createWorkspaceHandlers } from '../apps/web/src/lib/workspace-api.ts';

const started = '2026-09-01T00:00:00Z';
const book = (extra = {}) => ({
  id: 'b', title: '책', status: 'ACTIVE', total_pages: 300, reading_started_at: started, rereading_since: null, ...extra,
});
const now = '2026-10-09T01:00:00.000Z';

test('a book is before reading, reading, finished, re-read or archived', () => {
  assert.equal(readingState(book({ reading_started_at: null })), 'NOT_STARTED');
  assert.equal(readingState(book()), 'READING');
  assert.equal(readingState(book({ status: 'COMPLETED' })), 'FINISHED');
  assert.equal(readingState(book({ status: 'COMPLETED', rereading_since: now })), 'REREADING');
  assert.equal(readingState(book({ status: 'ARCHIVED', reading_started_at: null })), 'ARCHIVED');
});

test('starting, re-reading and stopping change only what they must', () => {
  assert.deepEqual(planReadingChange(book({ reading_started_at: null }), 'START', now), { reading_started_at: now });
  assert.equal(planReadingChange(book(), 'START', now), null, 'already started');
  assert.equal(planReadingChange(book({ status: 'COMPLETED' }), 'START', now), null, 'a finished book was started long ago');
  assert.deepEqual(planReadingChange(book({ status: 'COMPLETED' }), 'REREAD', now), { rereading_since: now });
  assert.equal(planReadingChange(book({ status: 'COMPLETED', rereading_since: started }), 'REREAD', now), null, 'already re-reading');
  assert.deepEqual(planReadingChange(book({ status: 'COMPLETED', rereading_since: started }), 'STOP_REREAD', now), { rereading_since: null });
  assert.equal(planReadingChange(book({ status: 'COMPLETED' }), 'STOP_REREAD', now), null);
  assert.throws(() => planReadingChange(book(), 'REREAD', now), /다 읽은 책만/);
  assert.throws(() => planReadingChange(book({ reading_started_at: null }), 'REREAD', now), /다 읽은 책만/);
  assert.throws(() => planReadingChange(book({ status: 'ARCHIVED' }), 'START', now), /보관한 책/);
});

test('a re-read carries on after the last page read again since it began', () => {
  const rereading = book({ status: 'COMPLETED', rereading_since: '2026-10-01T00:00:00Z' });
  const review = (id, end, at, extra = {}) => ({ id, event_type: 'REVIEW', voids_event_id: null, end_page: end, created_at: at, ...extra });
  assert.equal(rereadStartPage(rereading, []), 1, 'a fresh re-read starts at the first page');
  const events = [
    review('old', 280, '2026-09-20T00:00:00Z'),
    review('first', 60, '2026-10-02T00:00:00Z'),
    review('second', 120, '2026-10-05T00:00:00Z'),
    review('wrong', 200, '2026-10-06T00:00:00Z'),
    { id: 'void', event_type: 'VOID', voids_event_id: 'wrong', end_page: null, created_at: '2026-10-06T01:00:00Z' },
    { id: 'learn', event_type: 'LEARNING', voids_event_id: null, end_page: 300, created_at: '2026-10-07T00:00:00Z' },
  ];
  assert.equal(rereadStartPage(rereading, events), 121, 'earlier reviews and a withdrawn one do not count');
  assert.equal(rereadStartPage(book({ status: 'COMPLETED' }), events), 1, 'not re-reading');
  assert.equal(rereadStartPage(rereading, [review('end', 300, '2026-10-02T00:00:00Z')]), 300, 'never past the book');
});

test('reading the last page again ends the re-read, like the database does', () => {
  const rereading = book({ status: 'COMPLETED', rereading_since: started });
  assert.ok(endsReread(rereading, 'REVIEW', 300));
  assert.equal(endsReread(rereading, 'REVIEW', 299), false);
  assert.equal(endsReread(rereading, 'CORRECTION', 300), false);
  assert.equal(endsReread(book({ status: 'COMPLETED' }), 'REVIEW', 300), false, 'an ordinary review');
});

test('the library tells books not yet started from books being read', () => {
  const shelf = [
    book({ id: 'wish', title: 'wish', reading_started_at: null }),
    book({ id: 'now', title: 'now' }),
    book({ id: 'done', title: 'done', status: 'COMPLETED' }),
    book({ id: 'again', title: 'again', status: 'COMPLETED', rereading_since: started }),
  ].map((item) => ({ ...item, author: null }));
  const ids = (status) => filterLibrary(shelf, [], 'books', status, '').books.map((item) => item.id);
  assert.deepEqual(ids('NOT_STARTED'), ['wish']);
  assert.deepEqual(ids('ACTIVE'), ['now']);
  assert.deepEqual(ids('COMPLETED'), ['done', 'again'], 'a re-read is still a finished book');
  assert.deepEqual(ids('all'), ['wish', 'now', 'done', 'again']);
});

const id = '12345678-1234-4234-9234-123456789abc';
const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const patch = (body) =>
  new Request('http://localhost', { method: 'PATCH', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
function stub(row) {
  const writes = [];
  const api = createWorkspaceHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/user')) return Response.json({ id });
    if (target.pathname.endsWith('/resources') && init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      writes.push({ body, query: Object.fromEntries(target.searchParams) });
      return Response.json([{ ...row, ...body }]);
    }
    if (target.pathname.endsWith('/resources')) return Response.json([{ id, type: 'BOOK', ...row }]);
    return Response.json([]);
  });
  return { api, writes };
}

test('the library starts a book and a re-read through the book status endpoint', async () => {
  const fresh = stub(book({ id, reading_started_at: null }));
  const response = await fresh.api.BOOK_STATUS(patch({ reading: 'START' }), id);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reading: 'READING' });
  assert.deepEqual(Object.keys(fresh.writes[0].body), ['reading_started_at']);
  assert.equal(fresh.writes[0].query.status, 'eq.ACTIVE', 'only if it is still the book that was read');
  assert.equal(fresh.writes[0].query.user_id, `eq.${id}`);

  const finished = stub(book({ id, status: 'COMPLETED' }));
  assert.deepEqual(await (await finished.api.BOOK_STATUS(patch({ reading: 'REREAD' }), id)).json(), { reading: 'REREADING' });
  const again = stub(book({ id, status: 'COMPLETED', rereading_since: started }));
  assert.deepEqual(await (await again.api.BOOK_STATUS(patch({ reading: 'STOP_REREAD' }), id)).json(), { reading: 'FINISHED' });
  assert.deepEqual(again.writes[0].body, { rereading_since: null });
});

test('a change that is already true writes nothing, and an impossible one is refused', async () => {
  const reading = stub(book({ id }));
  assert.deepEqual(await (await reading.api.BOOK_STATUS(patch({ reading: 'START' }), id)).json(), { reading: 'READING' });
  assert.equal((await reading.api.BOOK_STATUS(patch({ reading: 'REREAD' }), id)).status, 409);
  assert.deepEqual(reading.writes, []);
  const archived = stub(book({ id, status: 'ARCHIVED' }));
  assert.equal((await archived.api.BOOK_STATUS(patch({ reading: 'START' }), id)).status, 409);
  for (const bad of [{ reading: 'FINISH' }, { reading: 'START', status: 'ACTIVE' }])
    assert.equal((await reading.api.BOOK_STATUS(patch(bad), id)).status, 400);
});
