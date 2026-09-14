import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speechWordDifferences } from '../apps/web/src/components/speech-diff.ts';

test('speech comparison ignores punctuation/case and preserves repeated-word alignment', () => {
  assert.deepEqual(speechWordDifferences('Hello, WORLD!', 'hello world'), []);
  assert.deepEqual(speechWordDifferences('I really really like tea', 'I really like green tea'), [
    { kind: 'missing', word: 'really' }, { kind: 'added', word: 'green' },
  ]);
});
test('speech comparison preserves Unicode and deterministically bounds adversarial input', () => {
  assert.deepEqual(speechWordDifferences('café 안녕', 'cafe 안녕'), [{ kind: 'missing', word: 'café' }, { kind: 'added', word: 'cafe' }]);
  const first = speechWordDifferences('a '.repeat(10000), 'b '.repeat(10000));
  assert.equal(first.length, 40);
  assert.deepEqual(first, speechWordDifferences('a '.repeat(10000), 'b '.repeat(10000)));
  assert.deepEqual(speechWordDifferences('a '.repeat(300) + 'x', 'a '.repeat(300) + 'y'), []);
});
