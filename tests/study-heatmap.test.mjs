import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heatmapLevel, buildHeatmap, computeStreak, formatStudyDuration } from '../apps/web/src/lib/study-heatmap.ts';

const day = (date, learningMinutes, recordedMinutes = 0, untimedEvents = 0) => ({
  date, learningMinutes, recordedMinutes, untimedEvents,
  learningPages: 0, reviewPages: 0, events: 0, timedEvents: 0, activeDays: 0, minutesPerPage: null,
});

test('heatmap levels follow fixed minute boundaries and treat an untimed-only day as level 1', () => {
  assert.equal(heatmapLevel(0, 0), 0);
  assert.equal(heatmapLevel(0, 1), 1);
  assert.equal(heatmapLevel(14, 0), 1);
  assert.equal(heatmapLevel(15, 0), 2);
  assert.equal(heatmapLevel(29, 0), 2);
  assert.equal(heatmapLevel(30, 0), 3);
  assert.equal(heatmapLevel(59, 0), 3);
  assert.equal(heatmapLevel(60, 0), 4);
});
test('buildHeatmap sums room and book minutes per day and levels each one', () => {
  const result = buildHeatmap([day('2026-09-11', 10, 0, 0), day('2026-09-12', 0, 0, 2), day('2026-09-13', 20, 15, 0)]);
  assert.deepEqual(result, [
    { date: '2026-09-11', minutes: 10, level: 1 },
    { date: '2026-09-12', minutes: 0, level: 1 },
    { date: '2026-09-13', minutes: 35, level: 3 },
  ]);
});
test('streak counts backward from today, or from yesterday when today has no record yet, and finds the longest run', () => {
  const heat = level => ({ date: '', minutes: 0, level });
  const days = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map((date, i) => ({ ...heat([1, 1, 0, 1, 1][i]), date }));
  assert.deepEqual(computeStreak(days, '2026-09-13'), { current: 2, longest: 2, asOf: '2026-09-13' });
  assert.deepEqual(computeStreak(days.slice(0, 4), '2026-09-13'), { current: 1, longest: 2, asOf: '2026-09-12' });
  assert.deepEqual(computeStreak([], '2026-09-13'), { current: 0, longest: 0, asOf: '2026-09-12' });
});
test('formatStudyDuration writes hours and minutes in Korean, omitting a zero part', () => {
  assert.equal(formatStudyDuration(0), '0분');
  assert.equal(formatStudyDuration(45), '45분');
  assert.equal(formatStudyDuration(60), '1시간');
  assert.equal(formatStudyDuration(90), '1시간 30분');
  assert.equal(formatStudyDuration(125.6), '2시간 6분');
});
