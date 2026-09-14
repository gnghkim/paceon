import type { TablesInsert } from '@paceon/shared';
import { z } from 'zod';

export type BookSource = 'MANUAL' | 'GOOGLE_BOOKS' | 'YES24';
export interface BookMetadata {
  title: string;
  authors: string[];
  isbn?: string;
  publisher?: string;
  pageCount?: number;
  thumbnail?: string;
  description?: string;
  publishedDate?: string;
  tableOfContents?: string;
  source: BookSource;
  sourceId?: string;
}
export interface BookDraft {
  title: string;
  authors: string[];
  totalPages: number;
  currentPage: number;
  isbn?: string;
  publisher?: string;
  coverUrl?: string;
  source: BookSource;
  sourceId?: string;
}
export class BookValidationError extends Error {}
function invalid(field: string): never { throw new BookValidationError(`Invalid ${field}`); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('book');
  return value as Record<string, unknown>;
}
function optionalText(value: unknown, field: string, max = 500): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > max) return invalid(field);
  return value.trim() || undefined;
}
export function normalizeIsbn(value: unknown): string | undefined {
  const text = optionalText(value, 'isbn', 32);
  if (!text) return undefined;
  const isbn = text.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(isbn) && /^(978|979)/.test(isbn)) {
    if ([...isbn].reduce((sum, c, i) => sum + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0) return isbn;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    if ([...isbn].reduce((sum, c, i) => sum + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0) return isbn;
  }
  return invalid('isbn');
}
function cover(value: unknown): string | undefined {
  const text = optionalText(value, 'coverUrl', 2048);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return invalid('coverUrl');
    return url.href;
  } catch { return invalid('coverUrl'); }
}
const bookInputSchema = z.object({
  title: z.string().max(500).trim().min(1),
  authors: z.array(z.string().max(200).trim()).max(20).default([]),
  totalPages: z.number().int().min(1).max(10_000_000),
  currentPage: z.number().int().min(0).default(0),
  source: z.enum(['MANUAL', 'GOOGLE_BOOKS', 'YES24']).default('MANUAL'),
  sourceId: z.string().max(128).nullish(),
  isbn: z.string().max(32).nullish(),
  publisher: z.string().max(500).nullish(),
  coverUrl: z.string().max(2048).nullish(),
}).refine(input => input.currentPage <= input.totalPages, { path: ['currentPage'], message: 'Exceeds total pages' });
export function validateBook(value: unknown): BookDraft {
  const parsed = bookInputSchema.safeParse(value);
  if (!parsed.success) return invalid(String(parsed.error.issues[0]?.path[0] ?? 'book'));
  const input = parsed.data;
  const { title, totalPages, currentPage, source } = input;
  const cleanAuthors = input.authors.filter(Boolean);
  const sourceId = optionalText(input.sourceId, 'sourceId', 128);
  if (source === 'GOOGLE_BOOKS' && (!sourceId || !/^[\w-]+$/.test(sourceId))) return invalid('sourceId');
  if (source === 'YES24' && (!sourceId || !/^[1-9]\d*$/.test(sourceId))) return invalid('sourceId');
  if (source === 'MANUAL' && sourceId) return invalid('sourceId');
  const isbn = normalizeIsbn(input.isbn);
  const publisher = optionalText(input.publisher, 'publisher');
  const coverUrl = cover(input.coverUrl);
  return { title, authors: cleanAuthors, totalPages, currentPage, source,
    ...(isbn ? { isbn } : {}), ...(publisher ? { publisher } : {}),
    ...(coverUrl ? { coverUrl } : {}), ...(sourceId ? { sourceId } : {}) };
}
export function toBookResource(book: BookDraft, userId: string): TablesInsert<'resources'> {
  return { user_id: userId, type: 'BOOK', workload_unit: 'PAGE', title: book.title,
    author: book.authors.join(', ') || null, publisher: book.publisher ?? null,
    isbn: book.isbn ?? null, cover_url: book.coverUrl ?? null,
    total_pages: book.totalPages, initial_completed_workload: book.currentPage,
    source: book.source, source_id: book.sourceId ?? null,
    status: book.currentPage === book.totalPages ? 'COMPLETED' : 'ACTIVE' };
}

export interface SearchOptions { startIndex?: number; maxResults?: number }
export type SearchResult =
  | { status: 'ok'; books: BookMetadata[]; totalItems: number; manualEntryAvailable: true }
  | { status: 'unavailable' | 'unsupported'; books: []; manualEntryAvailable: true };
export interface BookProvider {
  readonly id: 'MANUAL' | 'GOOGLE_BOOKS' | 'YES24';
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
}
export class ManualProvider implements BookProvider {
  readonly id = 'MANUAL';
  normalize(input: unknown): BookDraft { return validateBook({ ...record(input), source: 'MANUAL', sourceId: undefined }); }
  async search(_query: string): Promise<SearchResult> { return { status: 'unsupported', books: [], manualEntryAvailable: true }; }
}
export class YES24Provider implements BookProvider {
  readonly id = 'YES24';
  private readonly fetcher: typeof fetch;
  private readonly apiKey: string | undefined;
  constructor(options: { apiKey?: string; fetch?: typeof fetch } = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey?.trim() || undefined;
  }
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) return invalid('query');
    const startIndex = options.startIndex ?? 0;
    const maxResults = options.maxResults ?? 10;
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > 1000) return invalid('startIndex');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 40) return invalid('maxResults');
    if (!this.apiKey) return { status: 'unavailable', books: [], manualEntryAvailable: true };
    try {
      const signal = AbortSignal.timeout(5000);
      const firstPage = Math.floor(startIndex / maxResults) + 1;
      const offset = startIndex % maxResults;
      const items: unknown[] = [];
      let totalItems = 0;
      // A zero-based offset can overlap two of YES24's one-based pages.
      for (let page = firstPage; page <= firstPage + (offset ? 1 : 0); page++) {
        const url = new URL('https://apis.yes24.com/v1/goods/itemList');
        url.search = new URLSearchParams({ query: query.trim(), category: 'BOOK', detail: 'Y', page: String(page), pageSize: String(maxResults) }).toString();
        const response = await this.fetcher(url, { headers: { 'X-Api-Key': this.apiKey }, signal, cache: 'no-store', redirect: 'error' });
        const payload = record(await boundedJson(response));
        if (response.status === 404 && payload.success === false && payload.errorCode === 'SEARCH_001') break;
        if (!response.ok || payload.success !== true) throw new Error('upstream');
        const data = record(payload.data);
        if (!Array.isArray(data.items) || data.items.length > maxResults ||
          typeof data.totalCount !== 'number' || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 ||
          data.currentPage !== page || data.pageSize !== maxResults) throw new Error('shape');
        if (page === firstPage) totalItems = data.totalCount;
        items.push(...data.items);
        if (data.items.length < maxResults || page * maxResults >= data.totalCount) break;
      }
      const books: BookMetadata[] = [];
      for (const item of items.slice(offset, offset + maxResults)) {
        try { books.push(yes24Metadata(item)); } catch { /* Skip malformed individual records. */ }
      }
      return { status: 'ok', books, totalItems, manualEntryAvailable: true };
    } catch { return { status: 'unavailable', books: [], manualEntryAvailable: true }; }
  }
}
async function boundedJson(response: Response): Promise<unknown> {
  const limit = 2 * 1024 * 1024;
  const declaredSize = response.headers.get('content-length');
  if (declaredSize && Number(declaredSize) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new Error('response size');
  }
  if (!response.body) throw new Error('empty response');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        throw new Error('response size');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally { reader.releaseLock(); }
}
function yes24Metadata(value: unknown): BookMetadata {
  const item = record(value);
  const title = optionalText(item.title, 'title');
  if (!title || typeof item.itemId !== 'number' || !Number.isSafeInteger(item.itemId) || item.itemId <= 0) return invalid('metadata');
  const result: BookMetadata = { title, authors: [], source: 'YES24', sourceId: String(item.itemId) };
  if (typeof item.author === 'string' && item.author.trim()) result.authors = [item.author.trim().slice(0, 200)];
  for (const [key, field, max] of [['publisher', 'publisher', 500], ['publishDate', 'publishedDate', 32]] as const) {
    if (typeof item[key] === 'string' && item[key].trim()) result[field] = item[key].trim().slice(0, max);
  }
  if (typeof item.pages === 'number' && Number.isInteger(item.pages) && item.pages > 0 && item.pages <= 10_000_000) result.pageCount = item.pages;
  for (const identifier of [item.isbn13, item.isbn10]) {
    try { const isbn = normalizeIsbn(identifier); if (isbn) { result.isbn = isbn; break; } } catch { /* ISBN metadata is optional. */ }
  }
  try { const thumbnail = cover(item.cover); if (thumbnail) result.thumbnail = thumbnail; } catch { /* A cover is optional. */ }
  try {
    const detail = record(item.contentDetail);
    for (const [key, field] of [['bookIntroduction', 'description'], ['tableOfContents', 'tableOfContents']] as const) {
      if (typeof detail[key] === 'string' && detail[key].trim()) result[field] = detail[key].trim().slice(0, 20_000);
    }
  } catch { /* Content details are optional. */ }
  return result;
}
export class GoogleBooksProvider implements BookProvider {
  readonly id = 'GOOGLE_BOOKS';
  private readonly fetcher: typeof fetch;
  private readonly apiKey: string | undefined;
  constructor(options: { fetch?: typeof fetch; apiKey?: string } = {}) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.apiKey = options.apiKey;
  }
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult> {
    if (typeof query !== 'string' || !query.trim() || query.length > 200) return invalid('query');
    const startIndex = options.startIndex ?? 0;
    const maxResults = options.maxResults ?? 10;
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > 1000) return invalid('startIndex');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 40) return invalid('maxResults');
    let q = query.trim();
    try { const isbn = normalizeIsbn(q); if (isbn) q = `isbn:${isbn}`; } catch { /* A title or author is also a valid query. */ }
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.search = new URLSearchParams({ q, startIndex: String(startIndex), maxResults: String(maxResults), printType: 'books' }).toString();
    if (this.apiKey) url.searchParams.set('key', this.apiKey);
    try {
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(5000), cache: 'no-store', redirect: 'error' });
      if (!response.ok) throw new Error('upstream');
      const data = record(await response.json());
      if (typeof data.totalItems !== 'number' || !Number.isInteger(data.totalItems) || data.totalItems < 0 || (data.items !== undefined && !Array.isArray(data.items))) throw new Error('shape');
      const books: BookMetadata[] = [];
      for (const item of (data.items as unknown[] | undefined ?? []).slice(0, maxResults)) {
        try { books.push(googleMetadata(item)); } catch { /* Skip malformed individual records. */ }
      }
      return { status: 'ok', books, totalItems: data.totalItems, manualEntryAvailable: true };
    } catch { return { status: 'unavailable', books: [], manualEntryAvailable: true }; }
  }
}
function googleMetadata(value: unknown): BookMetadata {
  const item = record(value);
  const info = record(item.volumeInfo);
  const title = optionalText(info.title, 'title');
  const sourceId = optionalText(item.id, 'sourceId', 128);
  if (!title || !sourceId || !/^[\w-]+$/.test(sourceId)) return invalid('metadata');
  const result: BookMetadata = { title, authors: [], source: 'GOOGLE_BOOKS', sourceId };
  if (Array.isArray(info.authors)) result.authors = info.authors.filter((a): a is string => typeof a === 'string').slice(0, 20).map(a => a.trim().slice(0, 200)).filter(Boolean);
  for (const [key, max] of [['publisher', 500], ['description', 20_000], ['publishedDate', 32]] as const) {
    const value = info[key];
    if (typeof value === 'string' && value.trim()) result[key] = value.trim().slice(0, max);
  }
  if (typeof info.pageCount === 'number' && Number.isInteger(info.pageCount) && info.pageCount > 0 && info.pageCount <= 10_000_000) result.pageCount = info.pageCount;
  if (Array.isArray(info.industryIdentifiers)) {
    const identifiers = info.industryIdentifiers.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
    for (const type of ['ISBN_13', 'ISBN_10']) {
      for (const entry of identifiers.filter(x => x.type === type)) {
        try { const isbn = normalizeIsbn(entry.identifier); if (isbn) { result.isbn = isbn; break; } } catch { /* Ignore invalid ISBN metadata. */ }
      }
      if (result.isbn) break;
    }
  }
  try {
    const links = record(info.imageLinks);
    if (typeof links.thumbnail === 'string') {
      const url = new URL(links.thumbnail);
      if (url.protocol === 'http:' && (url.hostname === 'books.google.com' || url.hostname === 'books.googleusercontent.com')) url.protocol = 'https:';
      const thumbnail = cover(url.href);
      if (thumbnail) result.thumbnail = thumbnail;
    }
  } catch { /* A cover is optional. */ }
  return result;
}
