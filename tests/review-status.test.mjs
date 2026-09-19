import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as review from '../apps/web/src/lib/expression-review.ts';

test('review status distinguishes missing content, no scheduled cards, and available cards', () => {
  assert.equal(review.reviewStatus?.({ saved: 0, due: 0 }), 'empty');
  assert.equal(review.reviewStatus?.({ saved: 5, due: 0 }), 'scheduled');
  assert.equal(review.reviewStatus?.({ saved: 5, due: 3 }), 'ready');
});

test('completion requires graded cards and a successful fresh query with no due cards', () => {
  assert.equal(review.reviewStatus?.({ saved: 5, due: 0 }, 3), 'complete');
  assert.equal(review.reviewStatus?.({ saved: 5, due: 1 }, 3), 'ready');
  assert.equal(review.reviewStatus?.(null, 3), 'loading');
  assert.equal(review.reviewStatus?.(null, 3, true), 'error');
  assert.equal(review.reviewStatus?.({ saved: 5, due: 0 }, 3, true), 'error');
});
