import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  READING_TIMER_CAP_MINUTES,
  elapsedSeconds,
  formatElapsed,
  parseReadingTimer,
  readingTimerKey,
  timerResult,
} from '../apps/web/src/lib/reading-timer.ts';

const start = 1_700_000_000_000;
const timer = { resourceId: 'book', startedAt: start };
const after = (seconds) => start + seconds * 1000;

test('the timer counts wall clock, not time spent looking at the screen', () => {
  assert.equal(elapsedSeconds(timer, after(0)), 0);
  assert.equal(elapsedSeconds(timer, after(1800)), 1800);
  // A clock that jumps backwards must not produce a negative reading.
  assert.equal(elapsedSeconds(timer, start - 60_000), 0);
});

test('a finished sitting rounds to the nearest minute', () => {
  assert.equal(timerResult(timer, after(1800)).minutes, 30);
  assert.equal(timerResult(timer, after(1829)).minutes, 30);
  assert.equal(timerResult(timer, after(1831)).minutes, 31);
});

test('a few seconds is zero minutes rather than a padded one', () => {
  assert.equal(timerResult(timer, after(0)).minutes, 0);
  assert.equal(timerResult(timer, after(29)).minutes, 0);
  assert.equal(timerResult(timer, after(30)).minutes, 1);
  assert.equal(timerResult(timer, after(45)).minutes, 1);
});

test('a timer left running overnight refuses to fill the field itself', () => {
  const justUnder = timerResult(timer, after(READING_TIMER_CAP_MINUTES * 60));
  assert.equal(justUnder.overCap, false);
  assert.equal(justUnder.minutes, READING_TIMER_CAP_MINUTES);

  const over = timerResult(timer, after(READING_TIMER_CAP_MINUTES * 60 + 1));
  assert.equal(over.overCap, true);
  assert.equal(over.minutes, null, 'the reader confirms the real time instead');
  assert.ok(over.seconds > 0, 'the elapsed time is still reported for context');
});

test('the cap is four hours', () => {
  assert.equal(READING_TIMER_CAP_MINUTES, 240);
});

test('a stored timer survives a reload', () => {
  const stored = JSON.stringify(timer);
  assert.deepEqual(parseReadingTimer(stored, after(600)), timer);
});

test('damaged, empty or foreign stored values are discarded rather than trusted', () => {
  for (const raw of [
    null,
    '',
    'not json',
    '{}',
    '[]',
    JSON.stringify({ resourceId: 'book' }),
    JSON.stringify({ startedAt: start }),
    JSON.stringify({ resourceId: '', startedAt: start }),
    JSON.stringify({ resourceId: 'book', startedAt: 'soon' }),
    JSON.stringify({ resourceId: 'book', startedAt: Number.NaN }),
  ])
    assert.equal(parseReadingTimer(raw, after(60)), null, String(raw));
});

test('a timer that claims to start in the future is thrown away', () => {
  const ahead = JSON.stringify({ resourceId: 'book', startedAt: after(3600) });
  assert.equal(parseReadingTimer(ahead, start), null);
  // Starting exactly now is fine.
  assert.deepEqual(parseReadingTimer(JSON.stringify(timer), start), timer);
});

test('each account keeps its own timer', () => {
  assert.equal(readingTimerKey('a'), 'paceon:reading-timer:a');
  assert.notEqual(readingTimerKey('a'), readingTimerKey('b'));
});

test('elapsed time reads as minutes and seconds, adding hours once there are any', () => {
  assert.equal(formatElapsed(0), '00:00');
  assert.equal(formatElapsed(9), '00:09');
  assert.equal(formatElapsed(65), '01:05');
  assert.equal(formatElapsed(3599), '59:59');
  assert.equal(formatElapsed(3600), '1:00:00');
  assert.equal(formatElapsed(7265), '2:01:05');
  assert.equal(formatElapsed(-5), '00:00');
});
