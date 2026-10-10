import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { compareCounts, parseCounts } from '../deploy/nuc7/migrate/verify-counts.mjs';

test('psql lines and supabase csv output are read the same way', () => {
  const psql = 'public.resources,3,abc\nauth.users,1,\n';
  const csv = 'line\n"public.resources,3,abc"\n"auth.users,1,"\n';
  assert.deepEqual(parseCounts(psql), parseCounts(csv));
  assert.deepEqual(parseCounts(psql).get('public.resources'), { rows: 3, hash: 'abc' });
});

test('a changed row with the same count is still a difference', () => {
  const a = parseCounts('public.resources,3,abc\n');
  const b = parseCounts('public.resources,3,abd\n');
  assert.deepEqual(compareCounts(a, b), [{ table: 'public.resources', expected: '3 abc', actual: '3 abd' }]);
});

test('a table missing on one side is a difference', () => {
  const diff = compareCounts(parseCounts('public.a,1,a1\npublic.b,0,b2\n'), parseCounts('public.a,1,a1\n'));
  assert.deepEqual(diff, [{ table: 'public.b', expected: '0 b2', actual: null }]);
});

test('an unreadable file fails instead of passing as "no differences"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paceon-counts-'));
  writeFileSync(join(dir, 'a.csv'), 'public.a,1,a1\n');
  writeFileSync(join(dir, 'empty.csv'), 'Initialising login role...\n');
  const run = (x, y) => spawnSync(process.execPath, ['deploy/nuc7/migrate/verify-counts.mjs', join(dir, x), join(dir, y)], { encoding: 'utf8' });
  assert.equal(run('a.csv', 'a.csv').status, 0);
  assert.notEqual(run('empty.csv', 'empty.csv').status, 0);
  assert.notEqual(run('a.csv', 'empty.csv').status, 0);
});
