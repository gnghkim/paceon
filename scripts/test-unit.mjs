import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Tests needing Supabase Local, a built web app or a running worker have dedicated scripts.
// A new infrastructure test that breaks this naming fails loudly here instead of being skipped silently.
const infrastructure = /^(?:.+-integration|database-.+|health)\.test\.mjs$/;
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => name.endsWith('.test.mjs') && !infrastructure.test(name))
  .sort()
  .map(name => `tests/${name}`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
