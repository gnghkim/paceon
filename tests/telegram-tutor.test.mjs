import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardKey, deepLink, markMistake, shapeTurn } from '../apps/web/src/lib/telegram-tutor.ts';

test('the mistake is marked where it was written, ignoring case', () => {
  assert.deepEqual(markMistake('Yesterday I Go to the park.', 'go'), [
    { text: 'Yesterday I ', marked: false },
    { text: 'Go', marked: true },
    { text: ' to the park.', marked: false },
  ]);
  assert.deepEqual(markMistake('I go and go.', 'go').filter((s) => s.marked).length, 1, 'only the first is marked');
});

test('a mistake missing from the sentence leaves the sentence as it was', () => {
  assert.deepEqual(markMistake('Something else.', 'go'), [{ text: 'Something else.', marked: false }]);
  assert.deepEqual(markMistake('Hi', ''), [{ text: 'Hi', marked: false }]);
});

test('the deep link only carries a well-formed bot name and code', () => {
  assert.equal(deepLink('paceon_tutor_bot', 'AB12CD34'), 'https://t.me/paceon_tutor_bot?start=AB12CD34');
  assert.equal(deepLink(null, 'AB12CD34'), null);
  assert.equal(deepLink('evil.com/x', 'AB12CD34'), null);
  assert.equal(deepLink('paceon_tutor_bot', 'AB12CD34&x=1'), null);
});

const row = (extra = {}) => ({
  id: '62345678-1234-4234-9234-123456789abc',
  input_kind: 'TEXT',
  learner_text: 'Yesterday I go to the park and buyed a apple.',
  reply_text: 'Sounds fun! What did you do?\n\n[Feedback]\n• "go" → ||went||',
  tutor_turn: {
    transcript: '',
    learner_used_korean: false,
    reply: 'Sounds fun! What did you do?',
    mistakes: [
      { wrong: 'go', correct: 'went', rule: '과거형이에요.', category: 'grammar' },
      { wrong: 'buyed', correct: 'bought', rule: 'buy의 과거형', category: 'grammar' },
      { wrong: 'a apple', correct: 'an apple', rule: '모음 앞 an', category: 'grammar' },
    ],
    natural_version: 'Yesterday I went to the park and bought an apple.',
    tip: '',
    rewrite_check: { is_attempt: false, correct: false, comment: '' },
  },
  mistake_count: 3,
  rewrite_attempt: false,
  rewrite_correct: null,
  created_at: '2026-10-04T15:30:00Z',
  ...extra,
});

test('a turn is shown by the reader\'s local date, with every mistake and its card', () => {
  const cards = new Map([[cardKey('Go', 'WENT'), { dueOn: '2026-10-06', reviewCount: 1, occurrences: 2 }]]);
  const view = shapeTurn(row(), cards, 'Asia/Seoul');
  assert.equal(view.date, '2026-10-05', 'UTC 15:30 is already the next day in Seoul');
  assert.equal(view.reply, 'Sounds fun! What did you do?', 'the feedback section is shown as mistakes instead');
  assert.equal(view.mistakes.length, 3);
  assert.deepEqual(view.mistakes[0], { wrong: 'go', correct: 'went', rule: '과거형이에요.', card: { dueOn: '2026-10-06', reviewCount: 1, occurrences: 2 } });
  assert.equal(view.mistakes[2].card, null, 'the third mistake was not explained, so it has no card');
  assert.equal(view.naturalVersion, 'Yesterday I went to the park and bought an apple.');
  assert.equal(view.rewrite, null);
});

test('a rewrite attempt says whether it was right', () => {
  const view = shapeTurn(row({ rewrite_attempt: true, rewrite_correct: true, tutor_turn: { ...row().tutor_turn, mistakes: [] } }), new Map(), 'UTC');
  assert.deepEqual(view.rewrite, { correct: true });
  assert.equal(view.mistakes.length, 0);
});

test('a damaged turn record still shows what the learner wrote', () => {
  const view = shapeTurn(row({ tutor_turn: { mistakes: 'nope' }, reply_text: 'Hello' }), new Map(), 'UTC');
  assert.equal(view.learnerText, 'Yesterday I go to the park and buyed a apple.');
  assert.deepEqual(view.mistakes, []);
  assert.equal(view.reply, 'Hello');
});
