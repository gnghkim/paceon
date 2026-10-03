import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookReadingSpeed } from '../apps/web/src/lib/planning.ts';

const learning = (id, start, end, minutes, extra = {}) => ({ id, resource_id: 'book', event_type: 'LEARNING', start_page: start, end_page: end, duration_minutes: minutes, voids_event_id: null, ...extra });

test("a book's own timed readings give its reading speed", () => {
  // 28 pages in 12 minutes, the record behind the report that started this.
  assert.equal(bookReadingSpeed([learning('a', 1, 28, 12)], 'book'), 0.43);
  assert.equal(bookReadingSpeed([learning('a', 1, 10, 10), learning('b', 11, 40, 20)], 'book'), 0.75, 'pages and minutes are pooled, not averaged per record');
});

test('only timed readings of this book that still stand count', () => {
  const events = [
    learning('a', 1, 10, 30),
    learning('untimed', 11, 20, null),
    learning('zero', 21, 30, 0),
    learning('other', 1, 10, 100, { resource_id: 'other' }),
    { id: 'review', resource_id: 'book', event_type: 'REVIEW', start_page: 1, end_page: 10, duration_minutes: 100, voids_event_id: null },
    learning('voided', 31, 40, 100),
    { id: 'void', resource_id: 'book', event_type: 'VOID', start_page: null, end_page: null, duration_minutes: null, voids_event_id: 'voided' },
  ];
  assert.equal(bookReadingSpeed(events, 'book'), 3);
});

test('no timed reading means no speed, and an absurd one is not offered', () => {
  assert.equal(bookReadingSpeed([], 'book'), null);
  assert.equal(bookReadingSpeed([learning('a', 1, 10, null)], 'book'), null);
  assert.equal(bookReadingSpeed([learning('a', 1, 1000, 1)], 'book'), null, 'faster than a plan can store');
});
