import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

const args = ['exec', '-i', 'supabase_db_PaceOn', 'psql', '-X', '-qAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];

function sql(statement) {
  const result = spawnSync('docker', args, { input: statement, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}

function connection(userId, resourceId) {
  const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  let resolveLocked;
  let rejectLocked;
  const locked = new Promise((resolve, reject) => { resolveLocked = resolve; rejectLocked = reject; });
  const timer = setTimeout(() => rejectLocked(new Error('Timed out acquiring fixture KEY SHARE')), 15_000);
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    if (output.includes('fixture_locked')) { clearTimeout(timer); resolveLocked(); }
  });
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const exited = new Promise((resolve, reject) => {
    child.on('error', error => { clearTimeout(timer); rejectLocked(error); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (!output.includes('fixture_locked')) rejectLocked(new Error('Database connection failed before fixture lock'));
      resolve({ code, errors });
    });
  });
  child.stdin.write(`begin; set local role authenticated; select set_config('request.jwt.claim.sub','${userId}',true); select id from public.resources where id='${resourceId}' for key share;\n\\echo fixture_locked\n`);
  return { child, locked, exited };
}

test('distinct concurrent progress inserts do not deadlock upgrading FK locks', { timeout: 30_000 }, async () => {
  const userId = randomUUID();
  const resourceId = randomUUID();
  sql(`insert into auth.users(id,email) values ('${userId}','locks-${userId}@paceon.example'); insert into public.resources(id,user_id,title,type,total_pages) values ('${resourceId}','${userId}','Lock test','BOOK',100);`);
  const connections = [connection(userId, resourceId), connection(userId, resourceId)];
  try {
    // Both transactions hold FK-compatible KEY SHARE before either inserts.
    await Promise.all(connections.map(item => item.locked));
    for (const { child } of connections) {
      child.stdin.end(`insert into public.progress_events(user_id,resource_id,study_date,completed_workload,idempotency_key) values ('${userId}','${resourceId}',date '2026-09-14',10,'${randomUUID()}'); rollback;\n\\q\n`);
    }
    const results = await Promise.all(connections.map(item => item.exited));
    assert.ok(results.every(result => result.code === 0), results.map(result => result.errors).join('\n'));
  } finally {
    for (const { child } of connections) {
      if (!child.stdin.writableEnded) child.stdin.end('rollback;\n\\q\n');
    }
    await Promise.allSettled(connections.map(item => item.exited));
    sql(`delete from auth.users where id='${userId}';`);
  }
});
