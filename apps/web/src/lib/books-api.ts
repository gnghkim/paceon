import { BookValidationError, GoogleBooksProvider, YES24Provider, ManualProvider, validateBook, toBookResource } from '@paceon/books';
import type { BookProvider } from '@paceon/books';

export interface Config { url: string; key: string }
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function failure(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  if (error instanceof BookValidationError) return json({ error: error.message }, 400);
  return json({ error: 'Service temporarily unavailable' }, 503);
}
export function bookApiConfig(): Config | undefined {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : undefined;
}
function integerParam(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  const value = raw === null ? fallback : /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < min || value > max) throw new ApiError(400, `Invalid ${name}`);
  return value;
}
export async function readBody(request: Request, maxBytes = 16_384): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Expected application/json');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'Expected JSON body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new ApiError(413, 'Body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
}
export function createBookHandlers(config: Config | undefined, fetcher: typeof fetch = globalThis.fetch) {
  async function authenticate(request: Request) {
    const authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) throw new ApiError(401, 'Authentication required');
    if (!config) throw new ApiError(503, 'Supabase is not configured');
    const headers = { apikey: config.key, Authorization: authorization };
    const response = await fetcher(new URL('/auth/v1/user', config.url), { headers, signal: AbortSignal.timeout(5000), cache: 'no-store', redirect: 'error' });
    if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Invalid or expired token');
    if (!response.ok) throw new ApiError(503, 'Authentication unavailable');
    const user = await response.json();
    if (!user || typeof user.id !== 'string' || !user.id) throw new ApiError(503, 'Authentication unavailable');
    return { headers, userId: user.id as string, base: config.url };
  }
  return {
    authenticate,
    async POST(request: Request): Promise<Response> {
      try {
        const auth = await authenticate(request);
        const book = validateBook(await readBody(request));
        const response = await fetcher(new URL('/rest/v1/resources', auth.base), {
          method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
          body: JSON.stringify(toBookResource(book, auth.userId)), signal: AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store',
        });
        if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Invalid or expired token');
        if (!response.ok) throw new ApiError(503, 'Book could not be saved');
        const rows = await response.json();
        if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id) throw new ApiError(503, 'Invalid storage response');
        return json({ resource: rows[0] }, 201);
      } catch (error) { return failure(error); }
    },
    async GET(request: Request): Promise<Response> {
      try {
        const auth = await authenticate(request);
        const input = new URL(request.url);
        const limit = integerParam(input, 'limit', 20, 1, 100);
        const offset = integerParam(input, 'offset', 0, 0, 1_000_000);
        const url = new URL('/rest/v1/resources', auth.base);
        url.search = new URLSearchParams({ select: '*', type: 'eq.BOOK', user_id: `eq.${auth.userId}`, order: 'created_at.desc,id.desc', limit: String(limit), offset: String(offset) }).toString();
        const response = await fetcher(url, { headers: auth.headers, signal: AbortSignal.timeout(5000), cache: 'no-store', redirect: 'error' });
        if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Invalid or expired token');
        if (!response.ok) throw new ApiError(503, 'Books unavailable');
        const resources: unknown = await response.json();
        if (!Array.isArray(resources)) throw new ApiError(503, 'Invalid storage response');
        return json({ resources, limit, offset });
      } catch (error) { return failure(error); }
    },
  };
}
export function createSearchHandler(google: Pick<BookProvider, 'search'> = new GoogleBooksProvider(process.env.GOOGLE_BOOKS_API_KEY ? { apiKey: process.env.GOOGLE_BOOKS_API_KEY } : {})) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const query = url.searchParams.get('q') ?? '';
      if (!query.trim() || query.length > 200) throw new ApiError(400, 'Invalid query');
      const name = url.searchParams.get('provider') ?? 'google-books';
      const provider = name === 'google-books' ? google : name === 'yes24' ? new YES24Provider() : name === 'manual' ? new ManualProvider() : undefined;
      if (!provider) throw new ApiError(400, 'Invalid provider');
      const result = await provider.search(query, { startIndex: integerParam(url, 'startIndex', 0, 0, 1000), maxResults: integerParam(url, 'maxResults', 10, 1, 40) });
      return json(result, result.status === 'ok' ? 200 : result.status === 'unsupported' ? 501 : 503);
    } catch (error) { return failure(error); }
  };
}
