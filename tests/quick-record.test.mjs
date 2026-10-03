import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordableBooks } from '../apps/web/src/lib/quick-record.ts';

const book = (id, extra = {}) => ({
  id,
  title: id,
  type: 'BOOK',
  status: 'ACTIVE',
  total_pages: 100,
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
  assert.deepEqual(
    recordableBooks(data).map((x) => [x.book.id, x.plan?.id ?? null]),
    [
      ['a', '1'],
      ['d', null],
    ],
  );
});
test('a book finished without a plan is not offered for more reading', () => {
  const data = {
    today: '2026-09-13',
    resources: [book('done', { status: 'COMPLETED' }), book('open')],
    plans: [plan('archived', 'open', { status: 'ARCHIVED' })],
    sessions: [],
  };
  // Without a plan there is no review to record, and its last reading is corrected on the book page.
  assert.deepEqual(
    recordableBooks(data).map((x) => [x.book.id, x.plan]),
    [['open', null]],
  );
});
test('today is prioritized, completed books remain reviewable, active plan wins over history', () => {
  const data = {
    today: '2026-09-13',
    resources: [book('a', { status: 'COMPLETED' }), book('b'), book('c')],
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
