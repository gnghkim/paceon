import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialRecordBook, recordableBooks } from '../apps/web/src/lib/quick-record.ts';

const book = (id, extra = {}) => ({
  id,
  title: id,
  type: 'BOOK',
  status: 'ACTIVE',
  total_pages: 100,
  reading_started_at: '2026-09-01T00:00:00Z',
  rereading_since: null,
  ...extra,
});
const plan = (id, resource_id, extra = {}) => ({
  id,
  resource_id,
  status: 'ACTIVE',
  created_at: '2026-09-01',
  ...extra,
});
test('recordable books exclude archived, paused and non-book resources', () => {
  const data = {
    today: '2026-09-13',
    resources: [
      book('a'),
      book('b', { status: 'ARCHIVED' }),
      book('c'),
      book('d'),
      book('e', { type: 'VIDEO' }),
      book('f', { reading_started_at: null }),
    ],
    plans: [
      plan('1', 'a'),
      plan('2', 'b'),
      plan('3', 'c', { status: 'PAUSED' }),
      plan('history', 'c', { status: 'COMPLETED' }),
      plan('5', 'e'),
    ],
    sessions: [],
  };
  // d has no plan yet. It can still be read and recorded, so the timer never loses its minutes.
  // f was only added to the library; it waits for 독서 시작.
  assert.deepEqual(
    recordableBooks(data).map((x) => [x.book.id, x.plan?.id ?? null]),
    [
      ['a', '1'],
      ['d', null],
    ],
  );
});
test('a finished book is offered only while it is being re-read', () => {
  const data = {
    today: '2026-09-13',
    resources: [
      book('done', { status: 'COMPLETED' }),
      book('planned done', { status: 'COMPLETED' }),
      book('again', { status: 'COMPLETED', rereading_since: '2026-09-12T00:00:00Z' }),
      book('open'),
    ],
    plans: [
      plan('archived', 'open', { status: 'ARCHIVED' }),
      plan('finished', 'planned done', { status: 'COMPLETED' }),
    ],
    sessions: [],
  };
  // A finished book's last reading is corrected on the book page; the dialog is for reading now.
  assert.deepEqual(
    recordableBooks(data).map((x) => [x.book.id, x.plan]),
    [
      ['again', null],
      ['open', null],
    ],
  );
});
test('today is prioritized, a re-read keeps its finished plan, active plan wins over history', () => {
  const data = {
    today: '2026-09-13',
    resources: [book('a', { status: 'COMPLETED', rereading_since: '2026-09-12T00:00:00Z' }), book('b'), book('c')],
    plans: [
      plan('old', 'a', { status: 'COMPLETED' }),
      plan('new', 'a', { status: 'COMPLETED', created_at: '2026-09-12' }),
      plan('historic', 'b', { status: 'COMPLETED' }),
      plan('active', 'b'),
      plan('c', 'c'),
    ],
    sessions: [
      { resource_id: 'b', study_date: '2026-09-13', status: 'PLANNED' },
      { resource_id: 'a', study_date: '2026-09-13', status: 'SKIPPED' },
    ],
  };
  const before = JSON.stringify(data);
  assert.deepEqual(
    recordableBooks(data).map((x) => [x.book.id, x.plan.id]),
    [
      ['b', 'active'],
      ['a', 'new'],
      ['c', 'c'],
    ],
  );
  assert.equal(JSON.stringify(data), before);
});

test('the record dialog starts on the book being timed unless told otherwise', () => {
  const timing = { resourceId: 'a' };
  assert.equal(initialRecordBook('b', timing), 'b', 'the caller chose a book');
  assert.equal(initialRecordBook(undefined, timing), 'a', 'the header button opens on the timed book');
  assert.equal(initialRecordBook(undefined, null), '');
  assert.equal(initialRecordBook(undefined, { resourceId: 'm', unit: {} }), '', 'a chapter timer belongs to the chapter dialog');
});
