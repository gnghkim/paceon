import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPdfHandlers } from '../apps/web/src/lib/pdf-api.ts';
const id = '12345678-1234-4234-9234-123456789abc';
const config = { url: 'http://127.0.0.1:55321', key: 'public' };
const upload = (overrides = {}) => new Request('http://localhost', { method: 'POST', body: '%PDF-1.7\n', headers: { authorization: 'Bearer user-token', 'content-type': 'application/pdf', 'x-import-id': id, 'x-file-name': 'book.pdf', ...overrides } });
const authenticated = body => new Request('http://localhost', { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' } });
function fixture({ enabled = true, status = 'UPLOADING', missing = false, storageDuplicate = false, changedRetry = false } = {}) {
  const writes = [];
  const row = { id, user_id: id, filename: 'book.pdf', storage_path: `${id}/${id}.pdf`, file_size: 9, content_sha256: 'private', status, result: null, error_code: null, resource_id: null, created_at: '2026-09-13', updated_at: '2026-09-13' };
  const handler = createPdfHandlers(config, enabled, async (url, init) => {
    const path = new URL(url).pathname;
    assert.equal(init.headers.Authorization, 'Bearer user-token');
    if (path.endsWith('/user')) return Response.json({ id });
    if (init.method === 'POST') writes.push(path);
    if (path.endsWith('/begin_pdf_import')) return changedRetry ? Response.json({ code: '40001', message: 'private database message' }, { status: 503 }) : Response.json(row);
    if (path.endsWith('/queue_pdf_import')) return Response.json({ ...row, status: 'PENDING' });
    if (path.endsWith('/confirm_pdf_import')) return Response.json(id);
    if (path.includes('/storage/')) return storageDuplicate ? Response.json({ statusCode: '409', error: 'Duplicate' }, { status: 400 }) : Response.json({ Key: 'private' });
    if (path.endsWith('/pdf_imports')) return Response.json(missing ? [] : [row]);
    return Response.json([]);
  });
  return { handler, writes };
}
test('upload authenticates first and disabled or invalid files never reach storage', async () => {
  const { handler, writes } = fixture();
  assert.equal((await handler.UPLOAD(new Request('http://localhost'))).status, 401);
  assert.equal((await handler.UPLOAD(upload({ 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await fixture({ enabled: false }).handler.UPLOAD(upload())).status, 503);
  assert.equal(writes.length, 0);
});
test('upload resumes immutable existing object and queues owned durable import', async () => {
  const { handler, writes } = fixture({ storageDuplicate: true });
  const response = await handler.UPLOAD(upload());
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.import.status, 'PENDING');
  assert.equal('storage_path' in body.import, false);
  assert.equal(JSON.stringify(body).includes('private'), false);
  assert.ok(writes.at(-1).endsWith('/queue_pdf_import'));
});
test('retry of queued upload never reuploads or changes stored content', async () => {
  const { handler, writes } = fixture({ status: 'PENDING' });
  assert.equal((await handler.UPLOAD(upload())).status, 202);
  assert.equal(writes.some(path => path.includes('/storage/')), false);
});
test('serialization conflict is actionable 409 without database message disclosure', async () => {
  const { handler } = fixture({ changedRetry: true });
  const response = await handler.UPLOAD(upload());
  assert.equal(response.status, 409);
  assert.equal((await response.text()).includes('private database message'), false);
});
test('foreign imports cannot be read or confirmed; invalid actions cannot write', async () => {
  const { handler, writes } = fixture({ missing: true });
  assert.equal((await handler.GET(authenticated(), id)).status, 404);
  assert.equal((await handler.ACTION(authenticated({ action: 'confirm', title: 'My PDF', currentPage: 0 }), id)).status, 404);
  assert.equal((await handler.ACTION(authenticated({ action: 'confirm', title: 'My PDF', currentPage: -1 }), id)).status, 400);
  assert.equal(writes.length, 0);
});
