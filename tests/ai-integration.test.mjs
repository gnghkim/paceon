import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test } from 'node:test';

test('production AI routes and worker preserve ownership, provenance, retries and deterministic schedules', { timeout: 120_000 }, async () => {
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const config = JSON.parse(status.stdout);
  const base = new URL(config.API_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname));
  assert.equal(base.port, '55321', 'Only PaceOn Local is allowed');
  const users = [];
  const server = spawn(process.execPath, ['apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', '0'], {
    env: { ...process.env, AI_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: config.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.ANON_KEY },
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
  async function db(path, token = config.SERVICE_ROLE_KEY, body, method = body === undefined ? 'GET' : 'POST') {
    return fetch(new URL(path, base), { method, headers: { apikey: config.ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
  }
  async function auth(path, body, admin = false, method = 'POST') {
    const response = await db(path, admin ? config.SERVICE_ROLE_KEY : config.ANON_KEY, body, method);
    assert.ok(response.ok, 'Temporary local Auth operation succeeds');
    return response.json();
  }
  async function user() {
    const email = `phase6-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const created = await auth('/auth/v1/admin/users', { email, password, email_confirm: true }, true);
    users.push(created.id);
    const session = await auth('/auth/v1/token?grant_type=password', { email, password });
    return { id: created.id, token: session.access_token };
  }
  async function api(path, token, body) {
    return fetch(new URL(path, origin), { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
  }
  async function json(response, expected = 200) { assert.equal(response.status, expected); return response.json(); }
  const sanitized = job => {
    assert.deepEqual(Object.keys(job).sort(), ['id', 'kind', 'status', 'result', 'model', 'errorCode', 'sourceRevision', 'createdAt', 'updatedAt'].sort());
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      assert.equal(server.exitCode, null, 'Isolated production server stays running');
      if (origin) { try { ready = (await api('/api/health')).ok; } catch { /* Starting. */ } }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'Production server is ready');
    // claim_ai_job is global: refuse to consume unrelated jobs on this local DB.
    const active = await json(await db('/rest/v1/ai_jobs?select=id&status=in.(PENDING,PROCESSING)'));
    assert.equal(active.length, 0, 'Run with no other queued jobs or competing workers');
    const alice = await user();
    const bob = await user();
    const book = (await json(await api('/api/resources/books', alice.token, { title: 'Temporary AI integration', totalPages: 100 }), 201)).resource;
    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await json(await api(`/api/resources/books/${book.id}/plan`, alice.token, { options: {
      mode: 'PACE', startDate: tomorrow, timezone: 'UTC', dailyPages: 20, minutesPerPage: 1,
      availability: Array.from({ length: 7 }, (_, i) => ({ isoWeekday: i + 1, availableMinutes: 60 })),
    } }), 201);
    const workspace = () => api(`/api/workspace?resourceId=${book.id}`, alice.token).then(r => json(r));
    const before = await workspace();
    const path = `/api/resources/books/${book.id}/ai`;
    assert.equal((await api(path)).status, 401);
    assert.equal((await api(path, bob.token)).status, 404);
    assert.equal((await api(path, bob.token, { kind: 'BOOK_ANALYSIS' })).status, 404);
    assert.equal((await api(path, alice.token, { kind: 'UNKNOWN' })).status, 400);
    const empty = await json(await api(path, alice.token));
    assert.equal(empty.available, true);
    assert.equal(empty.jobs.length, 0, 'GET does not enqueue');
    const queued = await json(await api(path, alice.token, { kind: 'BOOK_ANALYSIS', outline: 'Part 1: Foundations' }), 202);
    sanitized(queued.job);
    assert.equal(queued.job.status, 'PENDING');
    const duplicates = await Promise.all(Array.from({ length: 3 }, () => api(path, alice.token, { kind: 'BOOK_ANALYSIS', outline: 'Part 1: Foundations' })));
    for (const response of duplicates) assert.equal((await json(response, 202)).job.id, queued.job.id);
    const foreignRows = await json(await db(`/rest/v1/ai_jobs?select=id&id=eq.${queued.job.id}`, bob.token));
    assert.equal(foreignRows.length, 0);
    assert.equal((await db('/rest/v1/rpc/claim_ai_job', alice.token, {})).status, 403);
    assert.equal((await db('/rest/v1/rpc/finish_ai_job', alice.token, {
      p_job_id: queued.job.id, p_lease_token: randomUUID(), p_result: null, p_model: null, p_provider_response_id: null,
      p_input_tokens: null, p_output_tokens: null, p_error_code: 'PROVIDER_ERROR',
    })).status, 403);
    assert.equal((await db(`/rest/v1/ai_jobs?id=eq.${queued.job.id}`, alice.token, { status: 'FAILED' }, 'PATCH')).status, 403);

    // Real production worker + real DB; only the provider response is a fixture.
    const fixture = spawnSync('docker', ['run', '--rm', '-i', '--add-host', 'host.docker.internal:host-gateway', '-v', `${resolve('services/ai-worker')}:/app`, 'paceon-ai-worker', 'python', 'tests/run_db_fixture.py', 'success'], {
      input: JSON.stringify({ supabase_url: 'http://host.docker.internal:55321', servicekey: config.SERVICE_ROLE_KEY }),
      encoding: 'utf8', windowsHide: true, timeout: 45_000,
    });
    assert.equal(fixture.status, 0, 'Production worker fixture exits successfully');
    assert.equal(JSON.parse(fixture.stdout).finishAccepted, true);
    const completed = await json(await api(path, alice.token));
    completed.jobs.forEach(sanitized);
    const analysis = completed.jobs.find(job => job.id === queued.job.id);
    assert.equal(analysis.status, 'COMPLETED');
    assert.ok(analysis.result.summary);
    assert.equal(analysis.sourceRevision, completed.sourceRevisions.BOOK_ANALYSIS);
    assert.equal((await json(await api(path, alice.token, { kind: 'BOOK_ANALYSIS', outline: 'Part 1: Foundations' }), 200)).job.id, analysis.id);
    const provenance = (await json(await db(`/rest/v1/ai_jobs?select=model,provider_response_id,input_tokens,output_tokens&id=eq.${analysis.id}`)))[0];
    assert.ok(provenance.model && provenance.provider_response_id);
    assert.ok(provenance.input_tokens >= 0 && provenance.output_tokens >= 0);
    const contextB = await json(await api(path, alice.token, { kind: 'BOOK_ANALYSIS', outline: 'Part 2: Different evidence' }), 202);
    const claimB = await json(await db('/rest/v1/rpc/claim_ai_job', undefined, {}));
    assert.equal(claimB.id, contextB.job.id);
    assert.equal(await json(await db('/rest/v1/rpc/finish_ai_job', undefined, {
      p_job_id: claimB.id, p_lease_token: claimB.lease_token, p_result: analysis.result,
      p_model: 'fixture-model', p_provider_response_id: 'resp_context_b', p_input_tokens: 1, p_output_tokens: 1, p_error_code: null,
    })), true);
    assert.equal((await json(await api(path, alice.token))).jobs[0].id, contextB.job.id);
    assert.equal((await json(await api(path, alice.token, { kind: 'BOOK_ANALYSIS', outline: 'Part 1: Foundations' }), 200)).job.id, analysis.id);
    const reusedA = await json(await api(path, alice.token));
    assert.equal(reusedA.jobs[0].id, analysis.id, 'A B A exposes reused A as latest result');
    assert.equal(reusedA.sourceRevisions.BOOK_ANALYSIS, analysis.sourceRevision, 'GET derives current outline from reused A');
    const afterAnalysis = await workspace();
    assert.deepEqual(afterAnalysis.sessions, before.sessions, 'AI leaves schedule unchanged');
    assert.deepEqual(afterAnalysis.plans, before.plans, 'AI leaves plan speed and targets unchanged');

    const coach = await json(await api(path, alice.token, { kind: 'COACH' }), 202);
    const claimed = await json(await db('/rest/v1/rpc/claim_ai_job', undefined, {}));
    assert.equal(claimed.id, coach.job.id);
    const finishBody = { p_job_id: claimed.id, p_lease_token: claimed.lease_token, p_result: { summary: 'Fixture', suggestions: ['Read the next scheduled section.'], confidence: 0.4 },
      p_model: 'fixture-model', p_provider_response_id: 'resp_fixture', p_input_tokens: 12, p_output_tokens: 15, p_error_code: null };
    assert.equal((await db('/rest/v1/rpc/finish_ai_job', undefined, { ...finishBody, p_result: { ...finishBody.p_result, secret: 'not allowed' } })).status, 400, 'Unexpected output fields rejected');
    assert.equal(await json(await db('/rest/v1/rpc/finish_ai_job', undefined, { ...finishBody, p_lease_token: randomUUID() })), false, 'Wrong lease cannot complete');
    assert.equal(await json(await db('/rest/v1/rpc/finish_ai_job', undefined, { ...finishBody, p_result: { providerMessage: 'must not persist' }, p_error_code: 'PROVIDER_ERROR' })), true);
    const failed = (await json(await api(path, alice.token))).jobs.find(job => job.id === coach.job.id);
    sanitized(failed);
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.errorCode, 'PROVIDER_ERROR');
    assert.equal(failed.result, null);
    assert.equal(failed.model, null);
    const retry = await json(await api(path, alice.token, { kind: 'COACH' }), 202);
    assert.notEqual(retry.job.id, failed.id, 'Failed job retries as a new durable job');
    const retriedClaim = await json(await db('/rest/v1/rpc/claim_ai_job', undefined, {}));
    assert.equal(retriedClaim.id, retry.job.id);
    assert.equal(await json(await db('/rest/v1/rpc/finish_ai_job', undefined, { ...finishBody, p_job_id: retriedClaim.id, p_lease_token: retriedClaim.lease_token })), true);
    const afterCoach = await workspace();
    assert.deepEqual(afterCoach.sessions, before.sessions);
    assert.deepEqual(afterCoach.plans, before.plans);
    await json(await api(`/api/resources/books/${book.id}/progress`, alice.token, {
      kind: 'LEARNING', idempotencyKey: randomUUID(), planId: before.plans[0].id,
      expectedPlanVersion: before.plans[0].version, expectedProgressVersion: 0, studyDate: today, endPage: 5, durationMinutes: 10,
    }), 201);
    const stale = await json(await api(path, alice.token));
    assert.notEqual(stale.sourceRevisions.BOOK_ANALYSIS, analysis.sourceRevision, 'Real progress makes analysis stale');
    assert.notEqual(stale.sourceRevisions.COACH, retry.sourceRevision, 'Real progress makes coach stale');
    assert.equal(stale.jobs.find(job => job.id === analysis.id).status, 'COMPLETED', 'Prior analysis retained');
    assert.equal((await workspace()).progress[book.id].completedThroughPage, 5);
  } finally {
    try { for (const id of users) await auth(`/auth/v1/admin/users/${id}`, undefined, true, 'DELETE'); }
    finally { if (server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
  }
});
