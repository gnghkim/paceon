import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heatmapLevel, buildHeatmap, computeStreak, countActiveDays, formatStudyDuration, heatmapWeeks, currentWeek, countWeekDays } from '../apps/web/src/lib/study-heatmap.ts';

const day = (date, learningMinutes, recordedMinutes = 0, untimedEvents = 0, untimedPages = 0) => ({
  date, learningMinutes, recordedMinutes, untimedEvents, untimedPages,
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
    { date: '2026-09-11', minutes: 10, untimedPages: 0, level: 1 },
    { date: '2026-09-12', minutes: 0, untimedPages: 0, level: 1 },
    { date: '2026-09-13', minutes: 35, untimedPages: 0, level: 3 },
  ]);
});
test('pages recorded without a time raise the colour without inventing recorded minutes', () => {
  // 40 pages at the observed 0.75 min/page reads as 30 minutes of study.
  const [heavy] = buildHeatmap([day('2026-09-11', 0, 0, 1, 40)], 0.75);
  assert.equal(heavy.level, 3);
  assert.equal(heavy.minutes, 0, 'the displayed minutes stay the ones actually recorded');
  assert.equal(heavy.untimedPages, 40);
  // The same day at a slower pace crosses into the next band.
  assert.equal(buildHeatmap([day('2026-09-11', 0, 0, 1, 40)], 1.5)[0].level, 4);
  // A short untimed record still reads as a light day, not a heavy one.
  assert.equal(buildHeatmap([day('2026-09-11', 0, 0, 1, 3)], 1)[0].level, 1);
});
test('the estimate falls back to a minute a page and never rescues an empty day', () => {
  assert.equal(buildHeatmap([day('2026-09-11', 0, 0, 1, 20)])[0].level, 2);
  assert.equal(buildHeatmap([day('2026-09-11', 0, 0, 1, 20)], null)[0].level, 2);
  assert.equal(buildHeatmap([day('2026-09-11', 0, 0, 1, 20)], 0)[0].level, 2);
  assert.equal(buildHeatmap([day('2026-09-11', 0, 0, 0, 0)], 2)[0].level, 0);
});
test('timed and untimed records on one day add up', () => {
  // 10 recorded minutes plus 20 pages at a minute each reads as 30 minutes.
  assert.equal(buildHeatmap([day('2026-09-11', 0, 10, 1, 20)], 1)[0].level, 3);
});
test('streak counts backward from today, or from yesterday when today has no record yet, and finds the longest run', () => {
  const heat = level => ({ date: '', minutes: 0, untimedPages: 0, level });
  const days = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map((date, i) => ({ ...heat([1, 1, 0, 1, 1][i]), date }));
  assert.deepEqual(computeStreak(days, '2026-09-13'), { current: 2, longest: 2, asOf: '2026-09-13' });
  assert.deepEqual(computeStreak(days.slice(0, 4), '2026-09-13'), { current: 1, longest: 2, asOf: '2026-09-12' });
  assert.deepEqual(computeStreak([], '2026-09-13'), { current: 0, longest: 0, asOf: '2026-09-12' });
});
test('heatmapWeeks pads to Monday-start weeks and labels each month once, on the week holding its 1st', () => {
  const span = (from, count) => Array.from({ length: count }, (_, i) => {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + i);
    return { date: date.toISOString().slice(0, 10), minutes: 0, untimedPages: 0, level: 0 };
  });
  // 2026-09-28 is a Monday; Oct 1 falls in the first week and Oct 5-7 in the second.
  const aligned = heatmapWeeks(span('2026-09-28', 21));
  assert.deepEqual(aligned.map(w => w.label), ['10월', '', '']);
  assert.equal(aligned[0].cells[0].date, '2026-09-28');
  // 2026-10-02 is a Friday: four leading blanks, no 1st anywhere, so the first week takes its month.
  const padded = heatmapWeeks(span('2026-10-02', 17));
  assert.deepEqual(padded[0].cells.slice(0, 4), [null, null, null, null]);
  assert.deepEqual(padded.map(w => w.label), ['10월', '', '']);
  // A first week with no 1st stays unlabeled when the next week already starts a month.
  // 2026-11-24 is a Tuesday: week one ends Sunday Nov 29, week two holds Dec 1.
  const nextStarts = heatmapWeeks(span('2026-11-24', 13));
  assert.deepEqual(nextStarts.map(w => w.label), ['', '12월']);
  // Across two months each month name appears exactly once.
  const twoMonths = heatmapWeeks(span('2026-09-28', 42)).map(w => w.label).filter(Boolean);
  assert.deepEqual(twoMonths, ['10월', '11월']);
  assert.deepEqual(heatmapWeeks([]), []);
});
test('active days count a day studied from either source and skip empty days', () => {
  const days = buildHeatmap([
    day('2026-09-11', 0, 10),
    day('2026-09-12', 25, 0),
    day('2026-09-13', 5, 5),
    day('2026-09-14', 0, 0),
    day('2026-09-15', 0, 0, 2),
  ]);
  assert.equal(countActiveDays(days), 4, '도서만·영어학습만·둘 다·시간 미입력 기록만 있는 날을 모두 센다');
  assert.equal(countActiveDays([day('2026-09-16', 0, 0)].map(d => ({ date: d.date, minutes: 0, level: 0 }))), 0);
  assert.equal(countActiveDays([]), 0);
});

test('formatStudyDuration writes hours and minutes in Korean, omitting a zero part', () => {
  assert.equal(formatStudyDuration(0), '0분');
  assert.equal(formatStudyDuration(45), '45분');
  assert.equal(formatStudyDuration(60), '1시간');
  assert.equal(formatStudyDuration(90), '1시간 30분');
  assert.equal(formatStudyDuration(125.6), '2시간 6분');
});

test('the current week runs Monday to Sunday around today', () => {
  const week = currentWeek([], '2026-09-16');
  assert.equal(week.length, 7);
  assert.equal(week[0].date, '2026-09-14');
  assert.equal(week[6].date, '2026-09-20');
  assert.deepEqual(week.map((day) => day.isoWeekday), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(week.find((day) => day.isToday).date, '2026-09-16');
});

test('a Sunday belongs to the week that started six days earlier', () => {
  const week = currentWeek([], '2026-09-20');
  assert.equal(week[0].date, '2026-09-14');
  assert.equal(week[6].isToday, true);
});

test('a Monday starts its own week', () => {
  const week = currentWeek([], '2026-09-14');
  assert.equal(week[0].isToday, true);
  assert.equal(week[0].date, '2026-09-14');
});

test('only days with a record count, and later days are marked as still to come', () => {
  const days = [
    { date: '2026-09-14', minutes: 30, level: 3 },
    { date: '2026-09-15', minutes: 0, level: 0 },
    { date: '2026-09-16', minutes: 0, level: 1 },
  ];
  const week = currentWeek(days, '2026-09-16');
  assert.deepEqual(week.map((day) => day.studied), [true, false, true, false, false, false, false]);
  assert.deepEqual(week.map((day) => day.isFuture), [false, false, false, true, true, true, true]);
  assert.equal(countWeekDays(week), 2);
});

test('a week with nothing recorded counts zero', () => {
  assert.equal(countWeekDays(currentWeek([], '2026-09-16')), 0);
});

test('the week crosses a month boundary without gaps', () => {
  const week = currentWeek([], '2026-10-01');
  assert.equal(week[0].date, '2026-09-28');
  assert.equal(week[6].date, '2026-10-04');
});
