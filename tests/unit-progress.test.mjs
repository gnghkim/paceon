import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completedUnits, unitProgress, unitStudies } from '../apps/web/src/lib/unit-progress.ts';

let n = 0;
const event = (unit_id, event_type, extra = {}) => ({
  id: `e${++n}`, unit_id, event_type, voids_event_id: null, study_date: '2026-09-19',
  duration_minutes: null, memo: null, created_at: `2026-09-19T00:00:${String(n).padStart(2, '0')}Z`, ...extra,
});

test('a unit is done when a learning record stands against it', () => {
  const events = [event('u1', 'LEARNING'), event('u2', 'REVIEW'), event(null, 'LEARNING')];
  assert.deepEqual([...completedUnits(events).keys()], ['u1'], 'a repeat alone does not finish a unit, nor does a page record');
});

test('undoing takes the unit back, and finishing again brings it back', () => {
  const first = event('u1', 'LEARNING');
  const undo = event(null, 'VOID', { voids_event_id: first.id });
  assert.equal(completedUnits([first, undo]).size, 0);
  const again = event('u1', 'LEARNING');
  const done = completedUnits([first, undo, again]);
  assert.equal(done.get('u1').id, again.id, 'the standing record is the later one');
});

test('the history of a unit shows the first study and every repeat, oldest first', () => {
  const first = event('u1', 'LEARNING', { study_date: '2026-09-10', duration_minutes: 30, memo: 'be동사' });
  const repeat = event('u1', 'REVIEW', { study_date: '2026-09-15', duration_minutes: 10 });
  const other = event('u2', 'LEARNING');
  assert.deepEqual(unitStudies([repeat, other, first], 'u1'), [
    { id: first.id, kind: 'FIRST', studyDate: '2026-09-10', minutes: 30, memo: 'be동사' },
    { id: repeat.id, kind: 'AGAIN', studyDate: '2026-09-15', minutes: 10, memo: null },
  ]);
});

test('an undone record disappears from the history but repeats remain', () => {
  const first = event('u1', 'LEARNING');
  const repeat = event('u1', 'REVIEW');
  const undo = event(null, 'VOID', { voids_event_id: first.id });
  assert.deepEqual(unitStudies([first, repeat, undo], 'u1').map((s) => s.kind), ['AGAIN']);
});

test('progress never rounds up to finished', () => {
  assert.deepEqual(unitProgress(115, 0), { done: 0, total: 115, percent: 0 });
  assert.deepEqual(unitProgress(115, 114), { done: 114, total: 115, percent: 99 });
  assert.deepEqual(unitProgress(115, 115), { done: 115, total: 115, percent: 100 });
  assert.deepEqual(unitProgress(0, 3), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(unitProgress(10, 99), { done: 10, total: 10, percent: 100 });
});

import { findStall } from '../apps/web/src/lib/unit-progress.ts';
const planned = (title, scheduledOn, extra = {}) => ({ title, minutes: 20, done: false, section: false, scheduledOn, ...extra });

test('a chapter pushed months out is pointed at, so the screen can say why', () => {
  const units = [
    planned('1강', '2026-09-20'), planned('2강', '2026-09-21'),
    planned('심화', '2027-01-11', { minutes: 74 }), planned('라이브', '2027-01-12', { minutes: 117 }),
  ];
  assert.deepEqual(findStall(units, '2026-09-19'), { title: '심화', minutes: 74, scheduledOn: '2027-01-11', gapDays: 112 });
});

test('an ordinary schedule, weekends off included, is not called stalled', () => {
  const units = [planned('1강', '2026-09-21'), planned('2강', '2026-09-25'), planned('3강', '2026-10-05')];
  assert.equal(findStall(units, '2026-09-19'), null);
});

test('finished chapters, headings and unscheduled ones are passed over', () => {
  const units = [
    planned('끝난 것', null, { done: true }), { title: '섹션', minutes: null, done: false, section: true, scheduledOn: null },
    planned('담기지 않은 것', null), planned('1강', '2026-09-20'),
  ];
  assert.equal(findStall(units, '2026-09-19'), null);
  // 첫 챕터부터 한참 뒤라면 그것도 밀린 것이다.
  assert.equal(findStall([planned('1강', '2026-12-01')], '2026-09-19').title, '1강');
});
