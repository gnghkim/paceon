import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePlanOptions, createInitialSchedule, calendarDays, summarizeBook } from '../apps/web/src/lib/planning.ts';

const options = { mode: 'PACE', startDate: '2026-09-14', timezone: 'Asia/Seoul', dailyPages: 20, minutesPerPage: 1, availability: [{ isoWeekday: 1, availableMinutes: 60 }] };
test('plan boundary rejects bad dates, duplicate weekdays and impossible inputs', () => {
  for (const bad of [{ startDate: '2026-02-30' }, { timezone: 'Fake/Zone' }, { dailyPages: 0 }, { minutesPerPage: 0 }, { availability: [options.availability[0], options.availability[0]] }, { mode: 'DEADLINE' }]) assert.throws(() => parsePlanOptions({ ...options, ...bad }));
});
test('initial plan reserves existing study time and uses saved book baseline', () => {
  const plan = createInitialSchedule({ total_pages: 100, initial_completed_workload: 20 }, parsePlanOptions(options), [{ study_date: '2026-09-14', estimated_minutes: 50 }]);
  assert.equal(plan.status, 'conflict');
  const feasible = createInitialSchedule({ total_pages: 100, initial_completed_workload: 20 }, parsePlanOptions(options), [{ study_date: '2026-09-14', estimated_minutes: 40 }]);
  assert.equal(feasible.status, 'ok');
  assert.equal(feasible.sessions[0].startPage, 21);
  assert.equal(feasible.sessions[0].pages, 20);
});
test('calendar is stable across month/year boundaries and book summaries do not invent forecasts', () => {
  const days = calendarDays('2026-02-15');
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-01-26');
  const summary = summarizeBook({ total_pages: 100, initial_completed_workload: 25 }, undefined);
  assert.equal(summary.percent, 25);
  assert.equal(summary.forecast, null);
});
test('decimal reading speed does not add a spurious minute', () => {
  const result = createInitialSchedule({ total_pages: 50, initial_completed_workload: 0 }, parsePlanOptions({ ...options, dailyPages: 50, minutesPerPage: 1.1, availability: [{ isoWeekday: 1, availableMinutes: 55 }] }), []);
  assert.equal(result.status, 'ok');
  assert.equal(result.sessions[0].estimatedMinutes, 55);
});
