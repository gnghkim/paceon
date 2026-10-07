import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPushHandlers } from '../apps/web/src/lib/push-api.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const user = '12345678-1234-4234-9234-123456789abc';
const endpoint = 'https://fcm.googleapis.com/fcm/send/device-one-token';

function stub() {
  const calls = [];
  const api = createPushHandlers(config, async (url, init = {}) => {
    const target = new URL(url);
    if (target.pathname.endsWith('/user')) return Response.json({ id: user });
    calls.push({ path: target.pathname, method: init.method ?? 'GET', query: Object.fromEntries(target.searchParams) });
    return new Response(null, { status: 204 });
  });
  return { api, calls };
}
const remove = (body) =>
  new Request('http://localhost/api/push', {
    method: 'DELETE',
    headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('turning one device off removes only that device', async () => {
  const { api, calls } = stub();
  assert.equal((await api.DELETE(remove({ endpoint }))).status, 200);
  assert.deepEqual(calls, [{ path: '/rest/v1/push_subscriptions', method: 'DELETE', query: { endpoint: `eq.${endpoint}`, user_id: `eq.${user}` } }]);
});

test('turning every device off removes all of the reader\'s devices, and only theirs', async () => {
  const { api, calls } = stub();
  const response = await api.DELETE(remove({ all: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { subscribed: false });
  assert.deepEqual(calls, [{ path: '/rest/v1/push_subscriptions', method: 'DELETE', query: { user_id: `eq.${user}` } }]);
});

test('a request that names neither a device nor all of them deletes nothing', async () => {
  for (const body of [{}, { all: false }, { all: 'yes' }, { endpoint, all: true }, { endpoint: 'short' }]) {
    const { api, calls } = stub();
    assert.equal((await api.DELETE(remove(body))).status, 400, JSON.stringify(body));
    assert.deepEqual(calls, []);
  }
});
