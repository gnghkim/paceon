import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_PHRASE_LENGTH,
  catchMessage,
  normalizePhrase,
} from '../apps/web/src/lib/word-catch.ts';

test('a word lifted out of a sentence loses what came with it', () => {
  assert.equal(normalizePhrase('  serendipity  '), 'serendipity');
  assert.equal(normalizePhrase('serendipity,'), 'serendipity');
  assert.equal(normalizePhrase('"serendipity"'), 'serendipity');
  assert.equal(normalizePhrase('(serendipity)'), 'serendipity');
  assert.equal(normalizePhrase('“serendipity”'), 'serendipity');
  assert.equal(normalizePhrase('serendipity?'), 'serendipity');
});

test('punctuation inside a word is left alone', () => {
  assert.equal(normalizePhrase("don't"), "don't");
  assert.equal(normalizePhrase('well-known'), 'well-known');
  assert.equal(normalizePhrase('co-op.'), 'co-op');
});

test('spacing inside a phrase collapses so one phrase is one entry', () => {
  assert.equal(normalizePhrase('put  off'), 'put off');
  assert.equal(normalizePhrase('put\toff'), 'put off');
  assert.equal(normalizePhrase(' keep   at  it '), 'keep at it');
});

test('nothing to save reads as nothing, not as an empty word', () => {
  for (const raw of ['', '   ', '...', '""', '?!', '\n\t'])
    assert.equal(normalizePhrase(raw), null, JSON.stringify(raw));
});

test('a phrase past the stored limit is refused rather than cut short', () => {
  assert.equal(normalizePhrase('a'.repeat(MAX_PHRASE_LENGTH)), 'a'.repeat(MAX_PHRASE_LENGTH));
  assert.equal(normalizePhrase('a'.repeat(MAX_PHRASE_LENGTH + 1)), null);
  // 다듬은 뒤의 길이로 판단한다.
  assert.equal(normalizePhrase(` ${'a'.repeat(MAX_PHRASE_LENGTH)} `), 'a'.repeat(MAX_PHRASE_LENGTH));
});

test('each outcome says what happened to that word', () => {
  assert.match(catchMessage('SAVED', 'put off'), /put off/);
  assert.match(catchMessage('SAVED', 'put off'), /단어장/);
  assert.match(catchMessage('DUPLICATE', 'put off'), /이미/);
  assert.equal(catchMessage('FAILED', 'put off').includes('put off'), false,
    '실패는 단어를 되풀이하지 않는다');
});
