import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// compose v2는 명령줄에 적힌 서비스의 profile을 저절로 켠다. ai-worker를 적은 up 명령은 Worker를 켜 버린다.
test('no documented command starts the worker unless it turns the worker on in the same step', () => {
  for (const file of ['docs/SELF_HOSTING.md', 'deploy/nuc7/PLAN.md']) {
    const offenders = readFileSync(file, 'utf8').split(/\r?\n/)
      .filter((line) => /\bup\b[^\n]*-d\b[^\n]*\bai-worker\b/.test(line) && !line.includes('PACEON_WORKER=on'));
    assert.deepEqual(offenders, [], `${file} starts ai-worker while it may be off`);
  }
});
