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

import { pagesPerHour, targetFix } from '../apps/web/src/lib/planning.ts';

test('a minutes-per-page value is also told as pages an hour, so bigger is not read as faster', () => {
  assert.equal(pagesPerHour(3), 20);
  assert.equal(pagesPerHour(2), 30);
  assert.equal(pagesPerHour(0.43), 139);
  assert.equal(pagesPerHour(0), null);
  assert.equal(pagesPerHour(Number.NaN), null);
});

const preview = (extra = {}) => ({ preview: true, status: 'ok', forecastBefore: '2026-10-10', forecastAfter: '2026-10-15', targetDate: '2026-10-07', mode: 'BALANCED', minutesPerPage: 3, speedSource: 'fallback', remainingPages: 124, sessions: [], conflicts: [], ...extra });

test('a missed target offers the setting that keeps it, with the faster measured speed', () => {
  // The reported case: balanced, three minutes a page typed in, 0.43 measured.
  assert.deepEqual(targetFix(preview(), 0.43), { mode: 'DEADLINE', minutesPerPage: 0.43 });
  // A deadline that cannot be placed at all is the same situation.
  assert.deepEqual(targetFix(preview({ status: 'conflict', mode: 'DEADLINE', forecastAfter: null, conflicts: [{ code: 'DEADLINE_CAPACITY' }] }), 0.43), { mode: 'DEADLINE', minutesPerPage: 0.43 });
});

test('a slower measured speed is never offered as a fix', () => {
  assert.deepEqual(targetFix(preview({ minutesPerPage: 0.3 }), 0.43), { mode: 'DEADLINE', minutesPerPage: 0.3 });
  assert.deepEqual(targetFix(preview(), null), { mode: 'DEADLINE', minutesPerPage: 3 });
});

test('nothing is offered when the target is met, absent, or already pursued with the best speed known', () => {
  assert.equal(targetFix(preview({ forecastAfter: '2026-10-07' }), 0.43), null);
  assert.equal(targetFix(preview({ targetDate: null }), 0.43), null);
  assert.equal(targetFix(preview({ status: 'conflict', mode: 'DEADLINE', forecastAfter: null, minutesPerPage: 0.43, conflicts: [{ code: 'DEADLINE_CAPACITY' }] }), 0.43), null);
  assert.equal(targetFix(preview({ status: 'conflict', forecastAfter: null, conflicts: [{ code: 'NO_AVAILABILITY' }] }), 0.43), null, 'no learning time is not fixed by a mode');
});
