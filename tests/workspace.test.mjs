import assert from 'node:assert/strict';
import { test } from 'node:test';

test('scheduler is importable as a standalone package without web or AI services', async () => {
  const { schedulerContract } = await import('../packages/scheduler/src/index.ts');
  assert.deepEqual(schedulerContract.modes, ['DEADLINE', 'PACE', 'BALANCED']);
  assert.equal(schedulerContract.implementation, 'book-scheduler-v1');
});
