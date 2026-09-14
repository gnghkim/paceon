// Explicit live verification: performs YES24 search and up to two paid OpenAI jobs.
// Credentials stay in memory. Creates/deletes only a new temporary local account.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

async function main() {
  const web = parseEnv(readFileSync('apps/web/.env.local', 'utf8'));
  const worker = parseEnv(readFileSync('services/ai-worker/.env', 'utf8'));
  for (const [key, value] of [['YES24_API_KEY', web.YES24_API_KEY], ['OPENAI_API_KEY', worker.OPENAI_API_KEY], ['OPENAI_MODEL', worker.OPENAI_MODEL]])
    if (!value?.trim()) throw new Error(`Missing ${key}; configure the ignored local environment file first.`);
  if (web.AI_ENABLED !== 'true' || worker.AI_ENABLED !== 'true') throw new Error('Enable AI in web and worker, and restart the worker before live verification.');
  const status = spawnSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', windowsHide: true });
  assert.equal(status.status, 0, 'Supabase Local must be running');
  const local = JSON.parse(status.stdout);
  const base = new URL(local.API_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
  assert.equal(base.port, '55321', 'Only PaceOn Local is supported');
  const origin = 'http://localhost:3000';
  let userId;
  let token;
  async function auth(path, body, admin = false, method = 'POST') {
    const key = admin ? local.SERVICE_ROLE_KEY : local.ANON_KEY;
    const response = await fetch(new URL(path, base), { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Local Auth operation failed (${response.status}).`);
    return response.json();
  }
  async function api(path, body) {
    const response = await fetch(new URL(path, origin), { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Local ${path.split('?')[0]} failed (${response.status}).`);
    return response.json();
  }
  try {
    const search = await api('/api/books/search?provider=yes24&q=%ED%81%B4%EB%A6%B0%20%EC%BD%94%EB%93%9C');
    const book = search.books?.find(book => book.source === 'YES24' && Number.isInteger(book.pageCount) && book.pageCount > 0);
    if (!book) throw new Error('YES24 returned no usable book with a page count; no guessed data was registered.');
    console.log(`YES24 search passed: ${search.books.length} results; selected page count ${book.pageCount}.`);
    const email = `live-provider-${randomUUID()}@paceon.example`;
    const password = randomUUID() + randomUUID();
    const created = await auth('/auth/v1/admin/users', { email, password, email_confirm: true }, true);
    userId = created.id;
    token = (await auth('/auth/v1/token?grant_type=password', { email, password })).access_token;
    const { resource } = await api('/api/resources/books', { title: book.title, authors: book.authors, totalPages: book.pageCount, currentPage: 0, source: book.source, sourceId: book.sourceId, ...(book.isbn ? { isbn: book.isbn } : {}), ...(book.publisher ? { publisher: book.publisher } : {}) });
    const endpoint = `/api/resources/books/${resource.id}/ai`;
    if (!(await api(endpoint)).available) throw new Error('Web AI feature is not active.');
    for (const kind of ['BOOK_ANALYSIS', 'COACH']) {
      const enqueued = await api(endpoint, { kind, ...(kind === 'BOOK_ANALYSIS' ? { outline: (book.tableOfContents ?? '').slice(0, 12000) } : {}) });
      console.log(`${kind}: queued; waiting for the actual worker/provider.`);
      const deadline = Date.now() + 150000;
      let done = false;
      while (Date.now() < deadline) {
        const state = await api(endpoint);
        const job = state.jobs.find(job => job.id === enqueued.job.id);
        if (job?.status === 'FAILED') throw new Error(`${kind} failed with safe code ${/^[A-Z_]+$/.test(job.errorCode ?? '') ? job.errorCode : 'UNKNOWN'}.`);
        if (job?.status === 'COMPLETED') {
          assert.ok(job.result, 'Validated provider output exists');
          console.log(`${kind}: completed with validated structured output.`);
          done = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      if (!done) throw new Error(`${kind} did not finish in 150 seconds. Check worker configuration.`);
    }
    console.log(`Live verification passed for both AI jobs on model ${worker.OPENAI_MODEL}.`);
  } finally {
    if (userId) {
      // No PDF/Storage objects are created by this check.
      await auth(`/auth/v1/admin/users/${userId}`, undefined, true, 'DELETE');
      console.log('Temporary live-verification account and records removed.');
    }
  }
}
main().catch(error => {
  // Never print raw upstream responses, request options, stack traces or keys.
  const safe = error instanceof Error && /^(Missing |Enable AI |Local |YES24 |Web AI |BOOK_ANALYSIS |COACH )/.test(error.message);
  console.error(safe ? error.message : 'Live verification failed. Check local service availability and provider configuration.');
  process.exitCode = 1;
});
