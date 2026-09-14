import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pdfActionSchema, pdfResultSchema } from '@paceon/pdf-schema';
import { ApiError, createBookHandlers, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import type { PdfImportView, PdfStatus } from './pdf-types.ts';
import { pdfFilename, readPdfBytes, readPdfUpload } from './pdf-storage.ts';

interface ImportRow {
  id: string; user_id: string; filename: string; storage_path: string; file_size: number;
  status: PdfStatus; result: unknown; error_code: string | null; resource_id: string | null;
  created_at: string; updated_at: string;
}
function view(row: ImportRow): PdfImportView {
  const result = pdfResultSchema.safeParse(row.result);
  const invalid = ['READY', 'IMPORTED'].includes(row.status) && !result.success;
  return { id: row.id, filename: row.filename, fileSize: row.file_size, status: invalid ? 'FAILED' : row.status,
    result: result.success ? result.data : null, errorCode: invalid ? 'INVALID_RESULT' : row.error_code,
    resourceId: row.resource_id, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function createPdfHandlers(config: Config | undefined, enabled: boolean, fetcher: typeof fetch = globalThis.fetch) {
  const authenticate = createBookHandlers(config, fetcher).authenticate;
  type Auth = Awaited<ReturnType<typeof authenticate>>;
  async function db(auth: Auth, path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    const url = new URL(`/rest/v1/${path}`, auth.base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetcher(url, { headers: { ...auth.headers, 'Content-Type': 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      if (error?.code === '40001') throw new ApiError(409, '같은 요청에 다른 파일이나 등록 정보가 있습니다. 상태를 다시 확인해 주세요.');
    }
    if (response.status === 401) throw new ApiError(401, '다시 로그인해 주세요.');
    if (response.status === 403) throw new ApiError(404, 'PDF 작업을 찾을 수 없습니다.');
    if (response.status === 429) throw new ApiError(429, '진행 중인 PDF가 많습니다. 완료하거나 취소한 뒤 다시 시도해 주세요.');
    if (response.status === 409) throw new ApiError(409, 'PDF 상태가 변경되었거나 같은 요청에 다른 파일이 있습니다. 상태를 다시 확인해 주세요.');
    if (response.status === 400) throw new ApiError(400, '파일 상태와 입력한 정보를 확인해 주세요.');
    if (!response.ok) throw new ApiError(503, 'PDF 작업을 연결하지 못했습니다. 상태를 확인한 뒤 다시 시도해 주세요.');
    return response.json();
  }
  async function get(auth: Auth, id: string): Promise<ImportRow | undefined> {
    z.uuid().parse(id);
    const rows = await db(auth, 'pdf_imports', { select: '*', id: `eq.${id}`, user_id: `eq.${auth.userId}`, limit: '1' });
    if (!Array.isArray(rows)) throw new ApiError(503, 'PDF 상태를 확인하지 못했습니다.');
    return rows[0] as ImportRow | undefined;
  }
  async function source(auth: Auth, resourceId: string): Promise<ImportRow | undefined> {
    z.uuid().parse(resourceId);
    const books = await db(auth, 'resources', { select: 'id', id: `eq.${resourceId}`, user_id: `eq.${auth.userId}`, type: 'eq.BOOK', limit: '1' });
    if (!Array.isArray(books) || !books.length) throw new ApiError(404, '자료를 찾을 수 없습니다.');
    const rows = await db(auth, 'pdf_imports', { select: '*', resource_id: `eq.${resourceId}`, user_id: `eq.${auth.userId}`, status: 'eq.IMPORTED', limit: '1' });
    if (!Array.isArray(rows)) throw new ApiError(503, 'PDF 정보를 불러오지 못했습니다.');
    return rows[0] as ImportRow | undefined;
  }
  function path(auth: Auth, row: ImportRow) {
    const expected = `${auth.userId}/${row.id}.pdf`;
    if (row.user_id !== auth.userId || row.storage_path !== expected) throw new ApiError(409, '파일 정보를 확인해 주세요.');
    return expected;
  }
  function handle(error: unknown) {
    if (error instanceof z.ZodError) return json({ error: '요청 번호, 제목과 현재 페이지를 확인해 주세요.' }, 400);
    if (error instanceof ApiError) return json({ error: /[가-힣]/.test(error.message) ? error.message : error.status === 401 ? '다시 로그인해 주세요.' : '요청을 처리하지 못했습니다.' }, error.status);
    return json({ error: '처리 결과를 확인하지 못했습니다. 목록을 새로고침하거나 같은 파일로 재시도해 주세요.' }, 503);
  }
  const rpc = (auth: Auth, name: string, body: unknown) => db(auth, `rpc/${name}`, {}, body);
  return {
    async LIST(request: Request) {
      try {
        const auth = await authenticate(request);
        const rows = await db(auth, 'pdf_imports', { select: '*', user_id: `eq.${auth.userId}`, order: 'created_at.desc,id.desc', limit: '20' });
        if (!Array.isArray(rows)) throw new ApiError(503, 'PDF 목록을 불러오지 못했습니다.');
        return json({ available: enabled, imports: (rows as ImportRow[]).map(view) });
      } catch (error) { return handle(error); }
    },
    async UPLOAD(request: Request) {
      try {
        const auth = await authenticate(request);
        if (!enabled) throw new ApiError(503, 'PDF 가져오기가 아직 연결되지 않았습니다. 직접 도서를 등록할 수 있습니다.');
        const id = z.uuid().parse(request.headers.get('x-import-id'));
        const filename = pdfFilename(request.headers.get('x-file-name'));
        const bytes = await readPdfUpload(request);
        let row = await rpc(auth, 'begin_pdf_import', { p_id: id, p_filename: filename, p_file_size: bytes.byteLength, p_content_sha256: createHash('sha256').update(bytes).digest('hex') }) as ImportRow;
        if (row.status === 'UPLOADING') {
          const response = await fetcher(new URL(`/storage/v1/object/learning-pdfs/${path(auth, row)}`, auth.base), {
            method: 'POST', headers: { ...auth.headers, 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: bytes,
            cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
          });
          let duplicate = response.status === 409;
          if (!response.ok && !duplicate && response.status === 400) {
            const data = await response.json().catch(() => null);
            duplicate = data?.error === 'Duplicate' && String(data?.statusCode) === '409';
          }
          if (!response.ok && !duplicate) throw new ApiError(503, '파일 업로드 결과를 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.');
          row = await rpc(auth, 'queue_pdf_import', { p_id: id }) as ImportRow;
        }
        return json({ import: view(row) }, 202);
      } catch (error) { return handle(error); }
    },
    async GET(request: Request, id: string) {
      try {
        const row = await get(await authenticate(request), id);
        if (!row) throw new ApiError(404, 'PDF 작업을 찾을 수 없습니다.');
        return json({ import: view(row) });
      } catch (error) { return handle(error); }
    },
    async ACTION(request: Request, id: string) {
      try {
        const auth = await authenticate(request);
        const action = pdfActionSchema.parse(await readBody(request));
        const row = await get(auth, id);
        if (!row) throw new ApiError(404, 'PDF 작업을 찾을 수 없습니다.');
        if (action.action === 'confirm') {
          const resourceId = await rpc(auth, 'confirm_pdf_import', { p_id: id, p_title: action.title, p_current_page: action.currentPage });
          return json({ resourceId }, 201);
        }
        if (!enabled) throw new ApiError(503, 'PDF 처리가 아직 연결되지 않았습니다.');
        const retried = await rpc(auth, 'retry_pdf_import', { p_id: id }) as ImportRow;
        return json({ import: view(retried) }, 202);
      } catch (error) { return handle(error); }
    },
    async DELETE(request: Request, id: string) {
      try {
        const auth = await authenticate(request);
        const row = await get(auth, id);
        if (row) {
          if (row.status === 'IMPORTED' || row.status === 'PROCESSING') throw new ApiError(409, '처리 중이거나 서재에 등록된 PDF는 여기서 삭제할 수 없습니다.');
          path(auth, row);
          await rpc(auth, 'discard_pdf_import', { p_id: id });
        }
        // Also makes an interrupted discard's exact object cleanup retryable.
        const response = await fetcher(new URL('/storage/v1/object/learning-pdfs', auth.base), {
          method: 'DELETE', headers: { ...auth.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [`${auth.userId}/${id}.pdf`] }),
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok && response.status !== 404) throw new ApiError(503, '목록에서 제거했지만 원본 정리가 끝나지 않았습니다. 같은 삭제 요청을 다시 시도해 주세요.');
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      } catch (error) { return handle(error); }
    },
    async SOURCE(request: Request, resourceId: string) {
      try {
        const row = await source(await authenticate(request), resourceId);
        return json({ import: row ? view(row) : null });
      } catch (error) { return handle(error); }
    },
    async FILE(request: Request, resourceId: string) {
      try {
        const auth = await authenticate(request);
        const row = await source(auth, resourceId);
        if (!row) throw new ApiError(404, '원본 PDF를 찾을 수 없습니다.');
        const response = await fetcher(new URL(`/storage/v1/object/authenticated/learning-pdfs/${path(auth, row)}`, auth.base), {
          headers: auth.headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new ApiError(503, '원본 PDF를 불러오지 못했습니다.');
        const bytes = await readPdfBytes(response.body);
        const filename = encodeURIComponent(row.filename).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${filename}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch (error) { return handle(error); }
    },
  };
}
