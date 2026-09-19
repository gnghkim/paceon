import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextToRead, sessionState, summarizeDay } from '../apps/web/src/lib/session-state.ts';

const session = (extra = {}) => ({
  id: 's',
  resource_id: 'book',
  study_date: '2026-09-16',
  start_page: 21,
  end_page: 40,
  planned_workload: 20,
  estimated_minutes: 20,
  status: 'PLANNED',
  ...extra,
});

test('a session is complete once the read progress passes its last page', () => {
  const state = sessionState(session(), 40, '2026-09-16');
  assert.equal(state.kind, 'COMPLETED');
  assert.equal(state.donePages, 20);
  assert.equal(state.remainingPages, 0);
});

test('reading past the planned range still completes the session', () => {
  const state = sessionState(session(), 55, '2026-09-16');
  assert.equal(state.kind, 'COMPLETED');
  assert.equal(state.donePages, 20);
});

test('a partly read session reports what is left', () => {
  const state = sessionState(session(), 30, '2026-09-16');
  assert.equal(state.kind, 'IN_PROGRESS');
  assert.equal(state.donePages, 10);
  assert.equal(state.remainingPages, 10);
});

test('progress stopping exactly before the range leaves the session untouched', () => {
  const state = sessionState(session(), 20, '2026-09-16');
  assert.equal(state.kind, 'PLANNED');
  assert.equal(state.donePages, 0);
  assert.equal(state.remainingPages, 20);
});

test('an untouched past session is missed, not planned', () => {
  assert.equal(sessionState(session(), 20, '2026-09-17').kind, 'MISSED');
  assert.equal(sessionState(session({ study_date: '2026-09-15' }), 20, '2026-09-16').kind, 'MISSED');
});

test('a past session that was partly read stays in progress rather than missed', () => {
  assert.equal(sessionState(session(), 30, '2026-09-17').kind, 'IN_PROGRESS');
});

test('a future session is never missed', () => {
  assert.equal(sessionState(session({ study_date: '2026-09-20' }), 20, '2026-09-16').kind, 'PLANNED');
});

test('sessions without a page range fall back to the stored status', () => {
  const open = session({ start_page: null, end_page: null, status: 'COMPLETED' });
  assert.equal(sessionState(open, 0, '2026-09-16').kind, 'COMPLETED');
  assert.equal(sessionState({ ...open, status: 'PLANNED' }, 0, '2026-09-16').kind, 'PLANNED');
  assert.equal(sessionState({ ...open, status: 'PLANNED' }, 0, '2026-09-17').kind, 'MISSED');
});

const progress = { book: { completedThroughPage: 40 }, other: { completedThroughPage: 0 } };
test('a day is done only when every session on it is done', () => {
  const done = summarizeDay([session(), session({ id: 't', start_page: 41, end_page: 50 })], progress, '2026-09-16');
  assert.equal(done.total, 2);
  assert.equal(done.completed, 1);
  assert.equal(done.allDone, false);
  assert.equal(done.remainingPages, 10);
});

test('a day with no sessions is not reported as finished', () => {
  const empty = summarizeDay([], progress, '2026-09-16');
  assert.equal(empty.allDone, false);
  assert.equal(empty.total, 0);
});

test('a fully read day reports every page and minute as done', () => {
  const day = summarizeDay([session()], progress, '2026-09-16');
  assert.equal(day.allDone, true);
  assert.equal(day.donePages, 20);
  assert.equal(day.remainingPages, 0);
  assert.equal(day.remainingMinutes, 0);
});

test('books with no recorded progress fall back to zero rather than crashing', () => {
  const day = summarizeDay([session({ resource_id: 'missing' })], {}, '2026-09-16');
  assert.equal(day.completed, 0);
  assert.equal(day.remainingPages, 20);
  assert.equal(day.remainingMinutes, 20);
});

test('skipped sessions are excluded before the day is summarized', () => {
  const day = summarizeDay([session(), session({ id: 'x', status: 'SKIPPED', start_page: 41, end_page: 60 })], progress, '2026-09-16');
  assert.equal(day.total, 1);
  assert.equal(day.allDone, true);
});

test('the first unfinished session is the one to read next', () => {
  const sessions = [
    session({ id: 'a', resource_id: 'one', start_page: 1, end_page: 20 }),
    session({ id: 'b', resource_id: 'two', start_page: 1, end_page: 20 }),
    session({ id: 'c', resource_id: 'three', start_page: 1, end_page: 20 }),
  ];
  assert.equal(nextToRead(sessions, {}, '2026-09-16'), 'a');
  // 첫 책을 다 읽으면 다음 책으로 넘어간다.
  assert.equal(nextToRead(sessions, { one: { completedThroughPage: 20 } }, '2026-09-16'), 'b');
  // 읽다 만 일정도 아직 읽을 것이다.
  assert.equal(
    nextToRead(sessions, { one: { completedThroughPage: 20 }, two: { completedThroughPage: 9 } }, '2026-09-16'),
    'b',
  );
});

test('nothing leads once the day is read, or when there is nothing to read', () => {
  const sessions = [session({ id: 'a', start_page: 1, end_page: 20 })];
  assert.equal(nextToRead(sessions, { book: { completedThroughPage: 20 } }, '2026-09-16'), null);
  assert.equal(nextToRead([], {}, '2026-09-16'), null);
});

test('a skipped session never leads', () => {
  const sessions = [
    session({ id: 'a', status: 'SKIPPED', start_page: 1, end_page: 20 }),
    session({ id: 'b', resource_id: 'two', start_page: 1, end_page: 20 }),
  ];
  assert.equal(nextToRead(sessions, {}, '2026-09-16'), 'b');
});
