import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStatistics, statisticsRange } from '../apps/web/src/lib/statistics.ts';

const book = { id: 'book', title: 'PDF book', source: 'PDF_IMPORT', type: 'BOOK', workload_unit: 'PAGE', total_pages: 100, initial_completed_workload: 10 };
const event = (id, extra = {}) => ({ id, resource_id: 'book', event_type: 'LEARNING', study_date: '2026-09-12', start_page: 11, end_page: 20, completed_workload: 10, duration_minutes: 5, voids_event_id: null, ...extra });
const input = (events = [], extra = {}) => ({ resources: [book], events, from: '2026-09-11', to: '2026-09-13', today: '2026-09-13', timezone: 'Asia/Seoul', ...extra });

test('empty statistics include zero days and exclude initial progress', () => {
  const result = buildStatistics(input());
  assert.equal(result.days.length, 3);
  assert.equal(result.summary.learningPages, 0);
  assert.equal(result.summary.minutesPerPage, null);
  assert.deepEqual(result.resources, []);
});
test('new pages, reviews, explicit zero and missing duration remain distinct', () => {
  const result = buildStatistics(input([
    event('a'), event('b', { event_type: 'REVIEW', duration_minutes: null }),
    event('c', { start_page: 21, end_page: 25, completed_workload: 5, study_date: '2026-09-13', duration_minutes: 0 }),
  ]));
  assert.deepEqual(result.summary, { learningPages: 15, reviewPages: 10, recordedMinutes: 5, events: 3, timedEvents: 2, untimedEvents: 1, activeDays: 2, minutesPerPage: 0.5 });
  assert.equal(result.resources[0].title, 'PDF book');
  assert.equal(result.days[0].events, 0);
  assert.equal(result.days[2].minutesPerPage, null);
});
test('VOID after selected period removes original and correction uses its new study date', () => {
  const events = [event('a'), event('v', { event_type: 'VOID', voids_event_id: 'a', study_date: '2026-09-13' }), event('replacement', { study_date: '2026-09-13', end_page: 15, completed_workload: 5 })];
  const result = buildStatistics(input(events, { to: '2026-09-12' }));
  assert.equal(result.summary.events, 0);
  assert.equal(buildStatistics(input(events)).summary.learningPages, 5);
});
test('other resources do not contaminate totals; corrupt history fails', () => {
  assert.equal(buildStatistics(input([event('a', { resource_id: 'foreign' })])).summary.events, 0);
  assert.throws(() => buildStatistics(input([event('a', { start_page: 12 })])));
});
test('review statistics reject missing bounds, invented workload and out-of-book pages', () => {
  for (const patch of [{ start_page: null, end_page: null, completed_workload: 999999 }, { completed_workload: 99 }, { end_page: 101, completed_workload: 91 }])
    assert.throws(() => buildStatistics(input([event('review', { event_type: 'REVIEW', ...patch })])), { name: 'ProgressError' });
});
test('multiple books keep per-resource totals while activity dates count once and stored dates remain stable', () => {
  const events = [event('a', { timezone: 'America/New_York' }), event('b', { resource_id: 'second', event_type: 'REVIEW', duration_minutes: 2 }), event('c', { resource_id: 'second', event_type: 'REVIEW', duration_minutes: 3 })];
  const result = buildStatistics(input(events, { timezone: 'Asia/Seoul', resources: [book, { ...book, id: 'second', title: 'Second' }] }));
  assert.equal(result.resources.length, 2);
  assert.equal(result.summary.activeDays, 1);
  assert.equal(result.summary.reviewPages, 20);
  assert.equal(result.summary.recordedMinutes, 10);
  assert.equal(result.days[1].events, 3);
  assert.equal(result.resources.find(row => row.id === 'second').reviewPages, 20);
});
test('ranges are real inclusive study dates and limited to 366 days', () => {
  assert.deepEqual(statisticsRange(undefined, undefined, '2026-09-13'), { from: '2026-08-15', to: '2026-09-13' });
  assert.deepEqual(statisticsRange('2024-02-29', '2024-02-29', '2026-09-13'), { from: '2024-02-29', to: '2024-02-29' });
  assert.doesNotThrow(() => statisticsRange('2024-01-01', '2024-12-31', '2026-09-13'));
  for (const dates of [['2026-02-29','2026-03-01'], ['2026-09-13','2026-09-12'], ['2026-09-13','2026-09-14'], ['2024-01-01','2025-01-01']]) assert.throws(() => statisticsRange(...dates, '2026-09-13'));
});
