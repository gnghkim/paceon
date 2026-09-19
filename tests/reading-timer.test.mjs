import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  READING_TIMER_CAP_MINUTES,
  elapsedSeconds,
  formatElapsed,
  isPaused,
  newReadingTimer,
  parseReadingTimer,
  pauseTimer,
  readingTimerKey,
  resumeTimer,
  timerResult,
} from '../apps/web/src/lib/reading-timer.ts';

const start = 1_700_000_000_000;
const timer = newReadingTimer('book', start);
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

test('a timer saved before pausing existed reads as running', () => {
  const legacy = JSON.stringify({ resourceId: 'book', startedAt: start });
  assert.deepEqual(parseReadingTimer(legacy, after(600)), timer);
  assert.equal(elapsedSeconds(parseReadingTimer(legacy, after(600)), after(600)), 600);
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

test('time stops growing while paused', () => {
  const paused = pauseTimer(timer, after(600));
  assert.equal(isPaused(paused), true);
  assert.equal(elapsedSeconds(paused, after(600)), 600);
  assert.equal(elapsedSeconds(paused, after(6000)), 600, 'an hour and a half later, still ten minutes');
});

test('resuming leaves the paused stretch out', () => {
  const resumed = resumeTimer(pauseTimer(timer, after(600)), after(900));
  assert.equal(isPaused(resumed), false);
  assert.equal(elapsedSeconds(resumed, after(900)), 600);
  assert.equal(elapsedSeconds(resumed, after(1200)), 900);
});

test('several pauses add up', () => {
  let t = timer;
  t = resumeTimer(pauseTimer(t, after(100)), after(200)); // 100 out
  t = resumeTimer(pauseTimer(t, after(500)), after(650)); // 150 out
  assert.equal(t.pausedMs, 250_000);
  assert.equal(elapsedSeconds(t, after(1000)), 750);
});

test('pressing pause or resume twice changes nothing the second time', () => {
  const once = pauseTimer(timer, after(600));
  assert.deepEqual(pauseTimer(once, after(900)), once, 'the first pause moment is kept');
  const back = resumeTimer(once, after(900));
  assert.deepEqual(resumeTimer(back, after(1200)), back);
  assert.deepEqual(resumeTimer(timer, after(300)), timer, 'resuming a running timer is a no-op');
});

test('finishing while paused records up to the pause, not up to now', () => {
  const paused = pauseTimer(timer, after(1800));
  assert.equal(timerResult(paused, after(9000)).minutes, 30);
});

test('the cap judges time read, not time since the start', () => {
  // 다섯 시간 중 두 시간을 멈췄다. 읽은 것은 세 시간이므로 자동으로 채운다.
  const t = resumeTimer(pauseTimer(timer, after(3600)), after(3600 * 3));
  const result = timerResult(t, after(3600 * 5));
  assert.equal(result.overCap, false);
  assert.equal(result.minutes, 180);
  // 멈춘 채 하루가 지나도 읽은 시간은 그대로다.
  const forgotten = pauseTimer(timer, after(1800));
  assert.equal(timerResult(forgotten, after(86_400)).minutes, 30);
});

test('a paused timer survives a reload as paused', () => {
  const paused = pauseTimer(resumeTimer(pauseTimer(timer, after(100)), after(200)), after(700));
  const restored = parseReadingTimer(JSON.stringify(paused), after(5000));
  assert.deepEqual(restored, paused);
  assert.equal(elapsedSeconds(restored, after(5000)), 600);
});

test('pause fields that cannot be true are discarded with the timer', () => {
  const base = { resourceId: 'book', startedAt: start };
  for (const extra of [
    { pausedAt: start - 1 },                      // 시작 전에 멈춤
    { pausedAt: after(999) },                     // 아직 오지 않은 시각에 멈춤
    { pausedAt: 'soon' },
    { pausedMs: -1 },
    { pausedMs: Number.NaN },
    { pausedMs: 'long' },
    { pausedMs: 601_000 },                        // 흐른 시간보다 오래 멈춤
    { pausedAt: after(300), pausedMs: 301_000 },  // 멈춘 시각까지보다 오래 멈춤
  ])
    assert.equal(parseReadingTimer(JSON.stringify({ ...base, ...extra }), after(600)), null, JSON.stringify(extra));
});

test('the title rides along and a missing or empty one is simply absent', () => {
  const titled = newReadingTimer('book', start, 'Deep Work');
  assert.equal(parseReadingTimer(JSON.stringify(titled), after(60)).title, 'Deep Work');
  assert.equal('title' in newReadingTimer('book', start), false);
  assert.equal('title' in newReadingTimer('book', start, ''), false);
  const blank = JSON.stringify({ ...timer, title: '   ' });
  assert.equal('title' in parseReadingTimer(blank, after(60)), false);
  const numeric = JSON.stringify({ ...timer, title: 42 });
  assert.equal('title' in parseReadingTimer(numeric, after(60)), false);
});

test('a clock that jumps backwards never produces negative paused time', () => {
  const paused = pauseTimer(timer, after(600));
  const resumed = resumeTimer(paused, after(300)); // 시계가 되감겼다
  assert.equal(resumed.pausedMs, 0);
  assert.equal(pauseTimer(timer, start - 5000).pausedAt, start, 'a pause never lands before the start');
});
