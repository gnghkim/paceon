import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { formatAppVersion, resolveAppVersion } from '../apps/web/app-version.mjs';

test('formats the commit date and seven-character hash', () => {
  assert.equal(formatAppVersion(' 2026-09-19\n', ' c77112d91\n'), '20260919-c77112d');
});

test('prefers an explicit public version', () => {
  assert.equal(resolveAppVersion({ NEXT_PUBLIC_APP_VERSION: ' release-1 ' }, () => {
    throw new Error('Git should not run');
  }), 'release-1');
});

test('falls back when git metadata is unavailable', () => {
  assert.equal(resolveAppVersion({}, () => {
    throw new Error('Git unavailable');
  }), '개발 버전');
});

test('settings page exposes the generated app version', async () => {
  const source = await readFile(
    new URL('../apps/web/src/app/(workspace)/settings/page.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /버전 정보/);
  assert.match(source, /NEXT_PUBLIC_APP_VERSION/);
});
