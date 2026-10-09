import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  completionRecord,
  describeTarget,
  formatStudyMinutes,
  justCompleted,
} from '../apps/web/src/lib/completion-record.ts';

const book = {
  id: 'book', status: 'COMPLETED', workload_unit: 'PAGE', total_pages: 300, total_units: null,
  initial_completed_workload: 0, unit_label: null,
};
let next = 0;
const event = (study_date, pages, extra = {}) => ({
  id: `e${next++}`, resource_id: 'book', unit_id: null, event_type: 'LEARNING', voids_event_id: null,
  study_date, completed_workload: pages, duration_minutes: null, ...extra,
});
const plan = (extra = {}) => ({ resource_id: 'book', status: 'COMPLETED', target_date: null, created_at: '2026-09-01T00:00:00Z', ...extra });

test('a finished book tells when it began, when it ended and how many days it was really read', () => {
  const events = [
    event('2026-09-01', 50, { duration_minutes: 60 }),
    event('2026-09-01', 30, { duration_minutes: 30 }),
    event('2026-09-05', 100, { duration_minutes: 120 }),
    event('2026-09-10', 120),
  ];
  const record = completionRecord(book, events, [plan()]);
  assert.equal(record.startedOn, '2026-09-01');
  assert.equal(record.finishedOn, '2026-09-10');
  assert.equal(record.spanDays, 10, 'both ends count');
  assert.equal(record.studyDays, 3, 'two records on one day are one day');
  assert.equal(record.amount, 300);
  assert.equal(record.dailyAverage, 100);
  assert.equal(record.minutes, 210);
  assert.equal(record.untimedRecords, 1);
  assert.equal(record.unitLabel, '쪽');
  assert.ok(record.book);
});

test('voided records, reviews and other books do not count', () => {
  const wrong = event('2026-08-20', 40);
  const events = [
    wrong,
    { ...event('2026-09-02', 0), event_type: 'VOID', voids_event_id: wrong.id, completed_workload: 0 },
    event('2026-09-02', 300),
    event('2026-09-20', 30, { event_type: 'REVIEW', duration_minutes: 20 }),
    event('2026-07-01', 10, { resource_id: 'other' }),
  ];
  const record = completionRecord(book, events, []);
  assert.equal(record.startedOn, '2026-09-02', 'the voided record no longer marks the start');
  assert.equal(record.finishedOn, '2026-09-02', 'a later review does not move the end');
  assert.equal(record.studyDays, 1);
  assert.equal(record.minutes, 0);
});

test('pages already read when the book was added are left out of the daily average', () => {
  const record = completionRecord({ ...book, initial_completed_workload: 80 }, [event('2026-09-01', 110), event('2026-09-03', 110)], []);
  assert.equal(record.initial, 80);
  assert.equal(record.amount, 220);
  assert.equal(record.dailyAverage, 110);
});

test('the daily average keeps one decimal', () => {
  const short = { ...book, total_pages: 100 };
  const record = completionRecord(short, [event('2026-09-01', 34), event('2026-09-02', 33), event('2026-09-03', 33)], []);
  assert.equal(record.dailyAverage, 33.3);
});

test('an unfinished book, or one never recorded, has no card', () => {
  assert.equal(completionRecord({ ...book, status: 'ACTIVE' }, [event('2026-09-01', 100)], []), null);
  assert.equal(completionRecord({ ...book, status: 'ARCHIVED' }, [event('2026-09-01', 300)], []), null);
  assert.equal(completionRecord({ ...book, initial_completed_workload: 300 }, [], []), null, 'added as already read');
});

test('a material counts finished chapters, not their workload', () => {
  const material = { ...book, id: 'm', workload_unit: 'UNIT', total_pages: null, total_units: 3, unit_label: '강' };
  const unit = (date, unitId, extra = {}) => event(date, 7, { resource_id: 'm', unit_id: unitId, ...extra });
  const undone = unit('2026-09-01', 'u1');
  const events = [
    undone,
    { ...event('2026-09-01', 0), resource_id: 'm', event_type: 'VOID', voids_event_id: undone.id, completed_workload: 0 },
    unit('2026-09-02', 'u1', { duration_minutes: 40 }),
    unit('2026-09-02', 'u2', { duration_minutes: 35 }),
    unit('2026-09-03', 'u2', { event_type: 'REVIEW', duration_minutes: 10 }),
    unit('2026-09-06', 'u3', { duration_minutes: 0 }),
  ];
  const record = completionRecord(material, events, [plan({ resource_id: 'm' })]);
  assert.equal(record.unitLabel, '강');
  assert.equal(record.book, false);
  assert.equal(record.amount, 3);
  assert.equal(record.studyDays, 2);
  assert.equal(record.dailyAverage, 1.5);
  assert.equal(record.spanDays, 5);
  assert.equal(record.minutes, 75);
  assert.equal(record.untimedRecords, 0, 'zero minutes is a time, not a blank');
});

test('the target date of the finished plan is compared with the last day read', () => {
  const events = [event('2026-09-01', 300)];
  const early = completionRecord(book, events, [plan({ target_date: '2026-09-04' })]);
  assert.equal(early.daysEarly, 3);
  assert.equal(describeTarget(early), '목표보다 3일 일찍');
  assert.equal(describeTarget(completionRecord(book, events, [plan({ target_date: '2026-08-30' })])), '목표보다 2일 늦게');
  assert.equal(describeTarget(completionRecord(book, events, [plan({ target_date: '2026-09-01' })])), '목표일에 맞춰 끝냈어요');
  const none = completionRecord(book, events, [plan()]);
  assert.equal(none.daysEarly, null);
  assert.equal(describeTarget(none), null);
  const latest = completionRecord(book, events, [
    plan({ target_date: '2026-09-02', created_at: '2026-08-01T00:00:00Z' }),
    plan({ target_date: '2026-09-10', created_at: '2026-08-20T00:00:00Z' }),
    plan({ target_date: '2026-12-01', status: 'ARCHIVED', created_at: '2026-08-25T00:00:00Z' }),
  ]);
  assert.equal(latest.targetDate, '2026-09-10', 'the most recent finished plan');
});

test('minutes read as hours and minutes', () => {
  assert.equal(formatStudyMinutes(0), '0분');
  assert.equal(formatStudyMinutes(45), '45분');
  assert.equal(formatStudyMinutes(120), '2시간');
  assert.equal(formatStudyMinutes(750), '12시간 30분');
});

test('the card pops up only on the save that finishes the book', () => {
  assert.ok(justCompleted(280, 300, 300));
  assert.equal(justCompleted(300, 300, 300), false, 'correcting a finished book');
  assert.equal(justCompleted(100, 200, 300), false);
  assert.equal(justCompleted(0, 0, null), false);
});
