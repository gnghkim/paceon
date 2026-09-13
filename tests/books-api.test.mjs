import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookHandlers, createSearchHandler } from '../apps/web/src/lib/books-api.ts';

const config = { url: 'http://127.0.0.1:55321', key: 'public-key' };
const post = body => new Request('http://localhost/api/resources/books', { method: 'POST', headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });
test('API verifies token and uses the same token with server-derived owner', async () => {
  const calls = [];
  const api = createBookHandlers(config, async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'real-owner' });
    return Response.json([{ id: 'saved', ...JSON.parse(init.body) }], { status: 201 });
  });
  const response = await api.POST(post({ title: 'Book', totalPages: 100, currentPage: 25, user_id: 'forged' }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).resource.user_id, 'real-owner');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer user-token');
  assert.equal(calls[1].init.headers.apikey, 'public-key');
});
test('missing/invalid authentication, oversized and invalid JSON requests are rejected', async () => {
  const api = createBookHandlers(config, async () => Response.json({ id: 'owner' }));
  assert.equal((await api.GET(new Request('http://localhost/api/resources/books'))).status, 401);
  assert.equal((await createBookHandlers(config, async () => new Response('', { status: 401 })).POST(post({}))).status, 401);
  assert.equal((await api.POST(post({ title: 'x'.repeat(17000) }))).status, 413);
  assert.equal((await api.POST(post({ title: 'Book', totalPages: 0 }))).status, 400);
  assert.equal((await api.POST(new Request('http://localhost', { method: 'POST', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: '{' }))).status, 400);
});
test('configuration/upstream failures are sanitized and list is bounded', async () => {
  assert.equal((await createBookHandlers(undefined).POST(post({}))).status, 503);
  const api = createBookHandlers(config, async () => { throw Error('secret'); });
  const response = await api.POST(post({}));
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('secret'));
  const listing = createBookHandlers(config, async url => String(url).endsWith('/auth/v1/user') ? Response.json({ id: 'owner' }) : Response.json([]));
  assert.equal((await listing.GET(new Request('http://localhost?limit=101', { headers: { authorization: 'Bearer token' } }))).status, 400);
});
test('search API exposes fallback and rejects unknown providers', async () => {
  const handler = createSearchHandler({ search: async () => ({ status: 'unavailable', books: [], manualEntryAvailable: true }) });
  const response = await handler(new Request('http://localhost?q=book'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).manualEntryAvailable, true);
  assert.equal((await handler(new Request('http://localhost?q=book&provider=unknown'))).status, 400);
  assert.equal((await handler(new Request('http://localhost?q=book&provider=manual'))).status, 501);
});
test('YES24 search uses the injected provider and preserves source metadata', async () => {
  const handler = createSearchHandler({ search: async () => { throw Error('wrong provider'); } }, { search: async (query, options) => {
    assert.equal(query, '클린 코드');
    assert.equal(options.startIndex, 10);
    return { status: 'ok', books: [{ title: '클린 코드', authors: [], source: 'YES24', sourceId: '12345', pageCount: 584 }], totalItems: 1, manualEntryAvailable: true };
  } });
  const response = await handler(new Request('http://localhost?q=%ED%81%B4%EB%A6%B0%20%EC%BD%94%EB%93%9C&provider=yes24&startIndex=10'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).books[0].source, 'YES24');
});
