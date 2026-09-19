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
  kind: 'EXPRESSION',
  resource_id: null,
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

const recall = (id, due_on) => card(id, due_on, { kind: 'RECALL', resource_id: 'book' });

test('a vocabulary backlog does not bury what was read today', () => {
  // 단어 스무 개가 오래 밀려 있고, 회상 카드는 오늘 막 예정일이 됐다.
  const cards = [
    ...Array.from({ length: 20 }, (_, i) => card(`w${String(i).padStart(2, '0')}`, '2026-08-01')),
    recall('r1', today),
  ];
  const picked = dueToday(cards, today);
  assert.equal(picked.length, 3);
  assert.ok(picked.some((c) => c.id === 'r1'), 'the recall card is asked today, not weeks from now');
  assert.equal(picked[0].id, 'w00', 'the kind that waited longest still goes first');
});

test('kinds alternate, each in its own oldest-first order', () => {
  const cards = [
    card('w1', '2026-09-01'), card('w2', '2026-09-02'), card('w3', '2026-09-03'),
    recall('r1', '2026-09-05'), recall('r2', '2026-09-06'),
  ];
  assert.deepEqual(dueToday(cards, today, 5).map((c) => c.id), ['w1', 'r1', 'w2', 'r2', 'w3']);
  // 회상이 더 오래 기다렸다면 회상부터다.
  const older = [card('w1', '2026-09-10'), recall('r1', '2026-09-01'), recall('r2', '2026-09-02')];
  assert.deepEqual(dueToday(older, today).map((c) => c.id), ['r1', 'w1', 'r2']);
});

test('one kind alone behaves exactly as before', () => {
  const cards = [recall('r2', '2026-09-02'), recall('r1', '2026-09-01'), recall('r3', '2030-01-01')];
  assert.deepEqual(dueToday(cards, today).map((c) => c.id), ['r1', 'r2']);
});

test('a recall card asks what is remembered instead of asking for a meaning', () => {
  const prompt = reviewPrompt({ kind: 'RECALL', phrase: 'Deep Work · 41–60쪽' });
  // 제목과 범위는 바로 위에 크게 나온다. 안내문이 되풀이하지 않는다.
  assert.doesNotMatch(prompt, /Deep Work/);
  assert.match(prompt, /펼치지 말고/);
  assert.match(prompt, /기억나는 것/);
  assert.doesNotMatch(prompt, /뜻/);
});
