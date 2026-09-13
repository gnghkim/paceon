import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('real PDF upload, parser, confirmation and page planning preserve ownership and retries', { timeout: 180_000 }, async () => {
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const config = JSON.parse(status.stdout);
  const base = new URL(config.API_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  assert.equal(base.port, '55321', 'Only PaceOn Local is allowed');
  let phase = 'startup';
  const users = [];
  const objects = [];
  const server = spawn(process.execPath, ['apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '0'], {
    env: { ...process.env, PDF_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: config.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let origin;
  let output = '';
  server.stdout.on('data', chunk => {
    output = (output + chunk.toString()).slice(-4096);
    const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
    if (match) origin = match[0];
  });
  server.stderr.resume();
  async function request(url, options) {
    try { return await fetch(url, options); }
    catch (cause) {
      throw new Error(`PDF integration phase=` + phase + ` request=` + (options?.method ?? 'GET') + ` ` + new URL(url).pathname + ` serverExit=` + server.exitCode, { cause });
    }
  }
  async function db(path, token = config.SERVICE_ROLE_KEY, body, method = body === undefined ? 'GET' : 'POST') {
    return request(new URL(path, base), { method, headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  }
  async function json(response, expected = 200) { assert.equal(response.status, expected); return response.json(); }
  async function user() {
    const email = `phase7-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const session = await json(await db('/auth/v1/signup', config.ANON_KEY, { email, password }));
    assert.ok(session.user?.id && session.access_token, 'Real signup returns authenticated session');
    const value = { id: session.user.id, token: session.access_token };
    users.push(value);
    return value;
  }
  async function api(path, token, body, method = body === undefined ? 'GET' : 'POST') {
    return request(new URL(path, origin), { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  }
  async function upload(owner, id, bytes, filename = 'sample.pdf') {
    const name = `${owner.id}/${id}.pdf`;
    if (!objects.includes(name)) objects.push(name);
    return request(new URL('/api/pdf-imports', origin), { method: 'POST', headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'application/pdf',
      'X-Import-Id': id, 'X-File-Name': encodeURIComponent(filename) }, body: bytes, signal: AbortSignal.timeout(30_000) });
  }
  function sanitized(job) {
    assert.deepEqual(Object.keys(job).sort(), ['id', 'filename', 'fileSize', 'status', 'result', 'errorCode', 'resourceId', 'createdAt', 'updatedAt'].sort());
  }
  function dockerPython(args, input, encoding = 'utf8') {
    // Keep the event loop free to process HTTP socket closures while Docker runs.
    return new Promise((resolveResult, reject) => {
      const child = spawn('docker', ['run', '--rm', '-i', '--add-host', 'host.docker.internal:host-gateway', '-v', `${resolve('services/ai-worker')}:/app`, 'paceon-ai-worker', 'python', ...args], {
        windowsHide: true, timeout: 50_000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks = [];
      let length = 0;
      let exceeded = false;
      child.stdout.on('data', chunk => {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) { exceeded = true; child.kill(); }
        else chunks.push(chunk);
      });
      // Worker diagnostics must never accidentally expose credentials or PDF text.
      child.stderr.resume();
      child.on('error', cause => reject(new Error(`PDF helper could not start during ${phase}`, { cause })));
      child.on('close', code => {
        if (code !== 0 || exceeded) { reject(new Error(`PDF helper failed during ${phase}: exit=${code}, outputLimit=${exceeded}`)); return; }
        const result = Buffer.concat(chunks);
        resolveResult(encoding ? result.toString(encoding) : result);
      });
      child.stdin.on('error', () => { /* The close/error handler reports process failure. */ });
      child.stdin.end(input);
    });
  }
  async function runParser() {
    const result = await dockerPython(['tests/run_pdf_db_fixture.py'], JSON.stringify({ supabase_url: 'http://host.docker.internal:55321', servicekey: config.SERVICE_ROLE_KEY }));
    assert.equal(JSON.parse(result).finishAccepted, true);
  }
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      assert.equal(server.exitCode, null, 'Isolated production server stays running');
      if (origin) { try { ready = (await api('/api/health')).ok; } catch { /* Starting. */ } }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Production server is ready');
    const active = await json(await db('/rest/v1/pdf_imports?select=id&status=in.(PENDING,PROCESSING)'));
    assert.equal(active.length, 0, 'Run with no unrelated queued imports or competing parser');
    phase = 'signup';
    const alice = await user();
    const bob = await user();
    assert.equal((await api('/api/pdf-imports')).status, 401);
    const empty = await json(await api('/api/pdf-imports', alice.token));
    assert.equal(empty.available, true);
    assert.deepEqual(empty.imports, [], 'GET does not enqueue');
    phase = 'generate PDF';
    const bytes = await dockerPython(['-c', "import sys; sys.path.insert(0,'tests'); from create_pdf_fixture import pdf_bytes; sys.stdout.buffer.write(pdf_bytes())"], undefined, null);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    phase = 'upload and ownership';
    const id = randomUUID();
    const path = `/api/pdf-imports/${id}`;
    const queued = (await json(await upload(alice, id, bytes), 202)).import;
    sanitized(queued);
    assert.equal(queued.status, 'PENDING');
    assert.equal(queued.fileSize, bytes.length);
    assert.equal((await json(await upload(alice, id, bytes), 202)).import.id, id, 'Upload retry reuses ID');
    assert.equal((await upload(alice, id, Buffer.concat([bytes, Buffer.from('\n% changed')]))).status, 409, 'Retry cannot change file');
    assert.equal((await api(path, bob.token)).status, 404);
    assert.equal((await api(path, bob.token, { action: 'confirm', title: 'Foreign', currentPage: 0 })).status, 404);
    assert.equal((await json(await db(`/rest/v1/pdf_imports?select=id&id=eq.${id}`, bob.token))).length, 0);
    assert.equal((await db('/rest/v1/rpc/claim_pdf_import', alice.token, {})).status, 403);
    assert.equal((await db('/rest/v1/rpc/finish_pdf_import', alice.token, { p_id: id, p_lease_token: randomUUID(), p_result: null, p_error_code: 'PARSE_ERROR' })).status, 403);
    assert.equal((await db(`/rest/v1/pdf_imports?id=eq.${id}`, alice.token, { status: 'READY', result: {} }, 'PATCH')).status, 403);
    const storagePath = `/storage/v1/object/authenticated/learning-pdfs/${alice.id}/${id}.pdf`;
    assert.equal((await db(storagePath, alice.token)).status, 200, 'Owner can download private original');
    assert.equal((await db(storagePath, bob.token)).ok, false, 'Foreign user cannot download original');
    assert.equal((await request(new URL(`/storage/v1/object/public/learning-pdfs/${alice.id}/${id}.pdf`, base))).ok, false, 'No public PDF URL');
    phase = 'parse PDF';
    await runParser();
    phase = 'read parsed PDF';
    const parsed = (await json(await api(path, alice.token))).import;
    sanitized(parsed);
    assert.equal(parsed.status, 'READY');
    assert.equal(parsed.result.pageCount, 6);
    assert.deepEqual(parsed.result.units.map(unit => [unit.startPage, unit.endPage]), [[1, 1], [2, 3], [4, 6]]);
    assert.match(parsed.result.textExcerpt, /Sample learning text page 1/);
    assert.ok(parsed.result.analysisOutline.length > 0);
    phase = 'confirm';
    const confirmation = { action: 'confirm', title: 'Imported learning PDF', currentPage: 1 };
    const resourceId = (await json(await api(path, alice.token, confirmation), 201)).resourceId;
    assert.equal((await json(await api(path, alice.token, confirmation), 201)).resourceId, resourceId);
    assert.equal((await api(path, alice.token, { ...confirmation, currentPage: 0 })).status, 409);
    assert.equal((await api(path, alice.token, { ...confirmation, title: 'Different' })).status, 409);
    assert.equal((await api(path, alice.token, undefined, 'DELETE')).status, 409);
    const resource = (await json(await db(`/rest/v1/resources?id=eq.${resourceId}`, alice.token)))[0];
    assert.equal(resource.type, 'BOOK');
    assert.equal(resource.workload_unit, 'PAGE');
    assert.equal(resource.source, 'PDF_IMPORT');
    assert.equal(resource.source_id, id);
    assert.equal(resource.total_pages, 6);
    assert.equal(resource.total_units, 3);
    assert.equal(resource.initial_completed_workload, 1);
    const units = await json(await db(`/rest/v1/resource_units?resource_id=eq.${resourceId}&order=sequence`, alice.token));
    assert.equal(units.length, 3);
    assert.ok(units.every(unit => unit.unit_type === 'SECTION' && unit.parent_unit_id === null && unit.workload === unit.end_page - unit.start_page + 1));
    assert.deepEqual(units.map(unit => unit.title), parsed.result.units.map(unit => unit.title));
    const source = `/api/resources/books/${resourceId}/pdf`;
    assert.equal((await json(await api(source, alice.token))).import.id, id);
    assert.equal((await api(source, bob.token)).status, 404);
    assert.equal((await api(`${source}/file`, bob.token)).status, 404);
    const download = await api(`${source}/file`, alice.token);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get('content-type'), 'application/pdf');
    assert.equal(download.headers.get('cache-control'), 'no-store');
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes, 'Download preserves exact original');
    phase = 'plan and progress';
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await json(await api(`/api/resources/books/${resourceId}/plan`, alice.token, { options: {
      mode: 'PACE', startDate: tomorrow, timezone: 'UTC', dailyPages: 2, minutesPerPage: 1,
      availability: Array.from({ length: 7 }, (_, i) => ({ isoWeekday: i + 1, availableMinutes: 60 })),
    } }), 201);
    const workspace = () => api(`/api/workspace?resourceId=${resourceId}`, alice.token).then(r => json(r));
    const planned = await workspace();
    assert.equal(planned.sessions[0].start_page, 2, 'Initial plan respects imported starting progress');
    await json(await api(`/api/resources/books/${resourceId}/progress`, alice.token, {
      kind: 'LEARNING', idempotencyKey: randomUUID(), planId: planned.plans[0].id,
      expectedPlanVersion: planned.plans[0].version, expectedProgressVersion: 0, studyDate: today, endPage: 2, durationMinutes: 5,
    }), 201);
    assert.equal((await workspace()).progress[resourceId].completedThroughPage, 2, 'Existing progress flow works for imported book');
    phase = 'malformed PDF';
    const badId = randomUUID();
    const badPath = `/api/pdf-imports/${badId}`;
    assert.equal((await upload(alice, randomUUID(), Buffer.from('not a PDF'))).status, 400, 'Invalid header rejected before queue');
    assert.equal((await json(await upload(alice, badId, Buffer.from('%PDF-1.7\nmalformed document')), 202)).import.status, 'PENDING');
    phase = 'parse PDF';
    await runParser();
    phase = 'read parsed PDF';
    const failed = (await json(await api(badPath, alice.token))).import;
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.result, null);
    assert.match(failed.errorCode, /^[A-Z][A-Z0-9_]{0,63}$/);
    assert.equal((await json(await api(badPath, alice.token, { action: 'retry' }), 202)).import.status, 'PENDING');
    phase = 'parse PDF';
    await runParser();
    phase = 'read parsed PDF';
    assert.equal((await json(await api(badPath, alice.token))).import.status, 'FAILED');
    assert.equal((await api(badPath, alice.token, undefined, 'DELETE')).status, 204);
    assert.equal((await api(badPath, alice.token)).status, 404);
    assert.equal((await db(`/storage/v1/object/authenticated/learning-pdfs/${alice.id}/${badId}.pdf`, alice.token)).ok, false, 'Discard removes exact original');
    assert.equal((await api(badPath, alice.token, undefined, 'DELETE')).status, 204, 'Repeated discard idempotent');
  } finally {
    try {
      phase = 'cleanup';
      // Real object cleanup always goes through Storage API before deleting fixture accounts.
      for (const name of objects) {
        const response = await db('/storage/v1/object/learning-pdfs', config.SERVICE_ROLE_KEY, { prefixes: [name] }, 'DELETE');
        assert.ok(response.ok, 'Exact temporary Storage object cleanup succeeds');
      }
      for (const owner of users) {
        const response = await db(`/auth/v1/admin/users/${owner.id}`, config.SERVICE_ROLE_KEY, undefined, 'DELETE');
        assert.ok(response.ok, 'Temporary test account cleanup succeeds');
      }
    } finally {
      if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    }
  }
});
