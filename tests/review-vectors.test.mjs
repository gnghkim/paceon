import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { nextReview } from '../apps/web/src/lib/expression-review.ts';

// The Telegram quiz computes the same intervals in Python. Both read this file.
const { vectors } = JSON.parse(readFileSync(new URL('../services/ai-worker/tests/fixtures/review-vectors.json', import.meta.url), 'utf8'));

test('web review intervals match the shared vectors', () => {
  assert.ok(vectors.length >= 10);
  for (const { step, grade, today, expected } of vectors)
    assert.deepEqual(nextReview(step, grade, today), expected, JSON.stringify({ step, grade, today }));
});
