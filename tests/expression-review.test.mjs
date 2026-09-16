import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DAILY_REVIEW_SIZE,
  REVIEW_INTERVALS,
  dueToday,
  firstReview,
  nextReview,
  reviewPrompt,
} from '../apps/web/src/lib/expression-review.ts';

const today = '2026-09-16';
const card = (id, due_on, extra = {}) => ({
  id,
  phrase: `phrase ${id}`,
  meaning: `meaning ${id}`,
  examples: [],
  review_step: 0,
  due_on,
  lookup: 'DONE',
  ...extra,
});

test('a newly saved expression is asked about tomorrow, not the same day', () => {
  assert.deepEqual(firstReview(today), { step: 0, dueOn: '2026-09-17' });
});

test('an easy answer moves to the next interval and a hard one starts over', () => {
  assert.deepEqual(nextReview(0, 'EASY', today), { step: 1, dueOn: '2026-09-19' });
  assert.deepEqual(nextReview(1, 'EASY', today), { step: 2, dueOn: '2026-09-23' });
  assert.deepEqual(nextReview(2, 'HARD', today), { step: 0, dueOn: '2026-09-17' });
});

test('an ordinary answer keeps the interval it already earned', () => {
  assert.deepEqual(nextReview(2, 'OK', today), { step: 2, dueOn: '2026-09-23' });
  assert.deepEqual(nextReview(0, 'OK', today), { step: 0, dueOn: '2026-09-17' });
});

test('the longest interval is a ceiling, not a step to fall off', () => {
  const last = REVIEW_INTERVALS.length - 1;
  assert.deepEqual(nextReview(last, 'EASY', today), { step: last, dueOn: '2026-10-16' });
  assert.deepEqual(nextReview(last, 'OK', today), { step: last, dueOn: '2026-10-16' });
});

test('a stored step outside the table never produces an impossible date', () => {
  for (const step of [-3, 99, 1.5, Number.NaN]) {
    const result = nextReview(step, 'OK', today);
    assert.ok(result.step >= 0 && result.step < REVIEW_INTERVALS.length, `step ${step}`);
    assert.match(result.dueOn, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('the intervals are the documented product defaults', () => {
  assert.deepEqual([...REVIEW_INTERVALS], [1, 3, 7, 14, 30]);
});

test('today asks about the cards that came due first', () => {
  const cards = [
    card('c', '2026-09-16'),
    card('a', '2026-09-10'),
    card('b', '2026-09-14'),
    card('d', '2026-09-20'),
  ];
  assert.deepEqual(dueToday(cards, today).map((c) => c.id), ['a', 'b', 'c']);
});

test('a card due later is never asked early', () => {
  assert.deepEqual(dueToday([card('a', '2026-09-17')], today), []);
});

test('a long backlog still shows the same small number', () => {
  const many = Array.from({ length: 40 }, (_, i) => card(String(i).padStart(2, '0'), '2026-09-01'));
  assert.equal(dueToday(many, today).length, DAILY_REVIEW_SIZE);
  assert.equal(DAILY_REVIEW_SIZE, 3);
});

test('asking for more is allowed, and asking for none returns none', () => {
  const many = Array.from({ length: 10 }, (_, i) => card(String(i), '2026-09-01'));
  assert.equal(dueToday(many, today, 6).length, 6);
  assert.equal(dueToday(many, today, 0).length, 0);
  assert.equal(dueToday(many, today, -1).length, 0);
});

test('cards due on the same day are ordered so the set never reshuffles', () => {
  const cards = [card('z', '2026-09-10'), card('a', '2026-09-10'), card('m', '2026-09-10')];
  assert.deepEqual(dueToday(cards, today).map((c) => c.id), ['a', 'm', 'z']);
});

test('the prompt asks for the meaning rather than showing it', () => {
  const prompt = reviewPrompt({ phrase: 'get around to' });
  assert.match(prompt, /get around to/);
  assert.doesNotMatch(prompt, /meaning/);
});
