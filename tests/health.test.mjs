import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const [service, url] of [
  ['web', process.env.WEB_HEALTH_URL ?? 'http://localhost:3000/api/health'],
  ['ai-worker', process.env.WORKER_HEALTH_URL ?? 'http://localhost:8000/health'],
]) {
  test(`${service} exposes a process liveness endpoint`, async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { status: 'ok', service, check: 'liveness' });
  });
}
