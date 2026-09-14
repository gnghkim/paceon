import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

test('real Auth tokens enforce REST ownership and concurrent plan/event writes', async () => {
  // Local CLI output is read in memory only; never print or persist keys/tokens.
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const config = JSON.parse(status.stdout);
  const base = new URL(config.API_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Only a local DB may be tested');
  const apiKey = config.ANON_KEY;
  const adminKey = config.SERVICE_ROLE_KEY;
  assert.ok(apiKey && adminKey, 'Local API credentials are required');
  const users = [];

  async function request(path, token, method = 'GET', body, admin = false) {
    const response = await fetch(new URL(path, base), {
      method,
      headers: {
        apikey: admin ? adminKey : apiKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }

  async function createUser() {
    const email = `phase1-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const created = await request('/auth/v1/admin/users', adminKey, 'POST', { email, password, email_confirm: true }, true);
    assert.equal(created.status, 200, 'create isolated test user');
    const id = created.data.id;
    users.push(id);
    const login = await request('/auth/v1/token?grant_type=password', apiKey, 'POST', { email, password });
    assert.equal(login.status, 200, 'sign in with real Auth API');
    return { id, token: login.data.access_token };
  }

  try {
    const alice = await createUser();
    const bob = await createUser();
    const resources = [];
    for (const [user, title] of [[alice, 'Alice private book'], [bob, 'Bob private book']]) {
      const result = await request('/rest/v1/resources', user.token, 'POST', {
        user_id: user.id, title, type: 'BOOK', total_pages: 100,
      });
      assert.equal(result.status, 201, 'owner creates a resource');
      resources.push(result.data[0]);
    }
    const [aliceResource, bobResource] = resources;
    const bobRows = await request('/rest/v1/resources?select=id', bob.token);
    assert.equal(bobRows.status, 200);
    assert.deepEqual(bobRows.data, [{ id: bobResource.id }], 'REST SELECT does not leak Alice');
    const forged = await request('/rest/v1/resources', bob.token, 'POST', {
      user_id: alice.id, title: 'Forged', type: 'BOOK', total_pages: 10,
    });
    assert.equal(forged.status, 403, 'RLS rejects forged owner');
    const update = await request(`/rest/v1/resources?id=eq.${aliceResource.id}`, bob.token, 'PATCH', { title: 'Stolen' });
    assert.equal(update.status, 200);
    assert.deepEqual(update.data, [], 'RLS prevents cross-user update');
    const anonymous = await request('/rest/v1/resources', apiKey);
    assert.equal(anonymous.status, 401, 'anonymous role has no table grant');

    const goal = await request('/rest/v1/goals', alice.token, 'POST', {
      user_id: alice.id, resource_id: aliceResource.id, title: 'Read', start_date: '2026-09-14', mode: 'PACE', preferred_daily_workload: 20,
    });
    assert.equal(goal.status, 201);
    const plan = await request('/rest/v1/plans', alice.token, 'POST', {
      user_id: alice.id, resource_id: aliceResource.id, goal_id: goal.data[0].id,
      start_date: '2026-09-14', mode: 'PACE', preferred_daily_workload: 20,
    });
    assert.equal(plan.status, 201);
    const revisions = await Promise.all(['2026-09-20', '2026-09-21'].map(forecast_date =>
      request(`/rest/v1/plans?id=eq.${plan.data[0].id}&version=eq.1`, alice.token, 'PATCH', { forecast_date })));
    assert.ok(revisions.every(result => result.status === 200));
    assert.deepEqual(revisions.map(result => result.data.length).sort(), [0, 1], 'only one concurrent CAS succeeds');
    assert.equal(revisions.find(result => result.data.length)?.data[0].version, 2);

    const event = {
      user_id: alice.id, resource_id: aliceResource.id, event_type: 'LEARNING', study_date: '2026-09-14',
      completed_workload: 10, start_page: 1, end_page: 10, idempotency_key: randomUUID(),
    };
    const duplicates = await Promise.all([request('/rest/v1/progress_events', alice.token, 'POST', event), request('/rest/v1/progress_events', alice.token, 'POST', event)]);
    assert.deepEqual(duplicates.map(result => result.status).sort(), [201, 409], 'concurrent retry inserts exactly once');
    const visibleEvents = await request('/rest/v1/progress_events', bob.token);
    assert.deepEqual(visibleEvents.data, [], 'events stay private over HTTP');
  } finally {
    const cleanupErrors = [];
    for (const id of users) {
      const result = await request(`/auth/v1/admin/users/${id}`, adminKey, 'DELETE', undefined, true);
      if (result.status !== 200) cleanupErrors.push(id);
    }
    assert.deepEqual(cleanupErrors, [], 'temporary test accounts are removed');
  }
});
