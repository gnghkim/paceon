import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catchUpTargets, readCatchUpMemory, catchUpKey } from '../apps/web/src/lib/catch-up.ts';

const today = '2026-09-16';
const book = (id, extra = {}) => ({
  id,
  title: `book ${id}`,
  status: 'ACTIVE',
  replan_required: false,
  progress_version: 3,
  total_pages: 100,
  ...extra,
});
const plan = (id, resource_id, extra = {}) => ({ id, resource_id, status: 'ACTIVE', version: 2, ...extra });
const session = (plan_id, study_date, start_page, end_page, extra = {}) => ({
  id: `${plan_id}:${study_date}`,
  plan_id,
  resource_id: extra.resource_id ?? 'a',
  study_date,
  start_page,
  end_page,
  planned_workload: end_page - start_page + 1,
  estimated_minutes: end_page - start_page + 1,
  status: 'PLANNED',
  ...extra,
});
const data = (extra = {}) => ({
  today,
  resources: [book('a')],
  plans: [plan('p', 'a')],
  sessions: [],
  progress: { a: { completedThroughPage: 20 } },
  ...extra,
});

test('a book left unread on a past study day is picked up with its remaining pages', () => {
  const targets = catchUpTargets(data({ sessions: [session('p', '2026-09-15', 21, 40)] }));
  assert.equal(targets.length, 1);
  assert.deepEqual(targets[0], {
    resourceId: 'a',
    title: 'book a',
    planId: 'p',
    expectedPlanVersion: 2,
    expectedProgressVersion: 3,
    missedPages: 20,
  });
});

test('only the unread part of a partly read past day is counted', () => {
  const targets = catchUpTargets(
    data({ sessions: [session('p', '2026-09-15', 21, 40)], progress: { a: { completedThroughPage: 30 } } }),
  );
  assert.equal(targets[0].missedPages, 10);
});

test('several missed days add up for the same plan', () => {
  const targets = catchUpTargets(
    data({ sessions: [session('p', '2026-09-14', 21, 40), session('p', '2026-09-15', 41, 60)] }),
  );
  assert.equal(targets.length, 1);
  assert.equal(targets[0].missedPages, 40);
});

test("today's and future sessions are never treated as missed", () => {
  assert.deepEqual(catchUpTargets(data({ sessions: [session('p', today, 21, 40)] })), []);
  assert.deepEqual(catchUpTargets(data({ sessions: [session('p', '2026-09-20', 21, 40)] })), []);
});

test('a past day that was fully read needs no catch up', () => {
  assert.deepEqual(
    catchUpTargets(data({ sessions: [session('p', '2026-09-15', 21, 40)], progress: { a: { completedThroughPage: 40 } } })),
    [],
  );
});

test('already skipped sessions are not counted again', () => {
  assert.deepEqual(
    catchUpTargets(data({ sessions: [session('p', '2026-09-15', 21, 40, { status: 'SKIPPED' })] })),
    [],
  );
});

test('a book already waiting for the reader to fix its plan is left alone', () => {
  assert.deepEqual(
    catchUpTargets(data({ resources: [book('a', { replan_required: true })], sessions: [session('p', '2026-09-15', 21, 40)] })),
    [],
  );
});

test('paused, completed and archived work is excluded', () => {
  const missed = [session('p', '2026-09-15', 21, 40)];
  for (const variant of [
    { plans: [plan('p', 'a', { status: 'PAUSED' })] },
    { plans: [plan('p', 'a', { status: 'COMPLETED' })] },
    { resources: [book('a', { status: 'ARCHIVED' })] },
    { resources: [book('a', { status: 'COMPLETED' })] },
  ])
    assert.deepEqual(catchUpTargets(data({ sessions: missed, ...variant })), []);
});

test('each plan is reported separately so one failure cannot hide another', () => {
  const targets = catchUpTargets(
    data({
      resources: [book('a'), book('b')],
      plans: [plan('p', 'a'), plan('q', 'b')],
      progress: { a: { completedThroughPage: 20 }, b: { completedThroughPage: 0 } },
      sessions: [
        session('p', '2026-09-15', 21, 40),
        session('q', '2026-09-15', 1, 5, { resource_id: 'b' }),
      ],
    }),
  );
  assert.deepEqual(
    targets.map((t) => [t.planId, t.missedPages]),
    [
      ['p', 20],
      ['q', 5],
    ],
  );
});

test('catch up runs once a day and reuses its key when retried', () => {
  const fresh = readCatchUpMemory(null, today);
  assert.equal(catchUpKey(fresh, 'p'), undefined);
  const saved = JSON.stringify({ date: today, keys: { p: 'key-1' } });
  assert.equal(catchUpKey(readCatchUpMemory(saved, today), 'p'), 'key-1');
  assert.equal(catchUpKey(readCatchUpMemory(saved, '2026-09-17'), 'p'), undefined);
});

test('damaged or foreign stored state falls back to a clean day', () => {
  for (const raw of ['not json', '{}', '[]', 'null', JSON.stringify({ date: today })])
    assert.deepEqual(readCatchUpMemory(raw, today).keys, {});
});
