import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SIDEBAR_KEY, readSidebarCollapsed, writeSidebarCollapsed } from '../apps/web/src/lib/sidebar.ts';

const memory = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data };
};

test('the sidebar stays open until the reader folds it, and remembers', () => {
  const storage = memory();
  assert.equal(readSidebarCollapsed(storage), false);
  writeSidebarCollapsed(storage, true);
  assert.equal(storage.data.get(SIDEBAR_KEY), '1');
  assert.equal(readSidebarCollapsed(storage), true);
  writeSidebarCollapsed(storage, false);
  assert.equal(readSidebarCollapsed(storage), false);
});

test('storage that is missing or refuses never breaks the layout', () => {
  const refusing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(readSidebarCollapsed(refusing), false);
  assert.doesNotThrow(() => writeSidebarCollapsed(refusing, true));
  assert.equal(readSidebarCollapsed(undefined), false);
  assert.equal(readSidebarCollapsed({ getItem: () => 'garbage' }), false);
});
