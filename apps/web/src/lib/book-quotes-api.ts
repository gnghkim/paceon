import { z } from 'zod';
import type { Resource, Tables } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { MAX_QUOTE_LENGTH, normalizeQuoteText, validQuotePage, type BookQuote } from './book-quotes.ts';

type QuoteRow = Tables<'book_quotes'>;

const text = z.string().max(MAX_QUOTE_LENGTH * 2);
const create = z
  .object({ page: z.number().int(), content: text, note: text.nullable().optional() })
  .strict();
const change = z
  .object({ page: z.number().int().optional(), content: text.optional(), note: text.nullable().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const toQuote = (row: QuoteRow): BookQuote => ({
  id: row.id,
  page: row.page,
  content: row.content,
  note: row.note,
  createdOn: row.created_at.slice(0, 10),
});

const LENGTH_ERROR = `문장과 생각은 각각 ${MAX_QUOTE_LENGTH}자 안으로 적어 주세요.`;

/** 빈 생각은 생각이 없는 것이다. 공백만 저장하지 않는다. */
function cleanNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null || !note.trim()) return null;
  const cleaned = normalizeQuoteText(note);
  if (!cleaned) throw new ApiError(400, LENGTH_ERROR);
  return cleaned;
}

/**
 * 책의 문장 기록. 책 화면과 독서 타이머에서 쓴다.
 * 책은 언제나 서버가 자기 서재에서 다시 읽는다. 남의 책이나 쪽이 없는 자료에는 남기지 않는다.
 */
export function createQuoteHandlers(config: Config | undefined, fetcher: typeof fetch = globalThis.fetch) {
  const storage = createWorkspaceHandlers(config, fetcher);
  type Auth = Awaited<ReturnType<typeof storage.authenticate>>;

  async function book(auth: Auth, bookId: string) {
    const [row] = await storage.rows<Resource>(auth, 'resources', { id: `eq.${z.uuid().parse(bookId)}` });
    if (!row || row.workload_unit !== 'PAGE') throw new ApiError(404, '책을 찾을 수 없어요.');
    return row;
  }

  function checkPage(page: number, row: Resource) {
    if (!validQuotePage(page, row.total_pages))
      throw new ApiError(400, row.total_pages ? `쪽은 1에서 ${row.total_pages} 사이로 적어 주세요.` : '쪽을 확인해 주세요.');
  }

  return {
    /** 이 책에서 남긴 문장. 책의 순서대로다. */
    async LIST(request: Request, bookId: string) {
      try {
        const auth = await storage.authenticate(request);
        const row = await book(auth, bookId);
        const rows = await storage.rows<QuoteRow>(auth, 'book_quotes', {
          resource_id: `eq.${row.id}`,
          order: 'page.asc,created_at.asc,id.asc',
        });
        return json({ quotes: rows.map(toQuote) });
      } catch (error) {
        return fail(error);
      }
    },

    async CREATE(request: Request, bookId: string) {
      try {
        const auth = await storage.authenticate(request);
        const input = create.parse(await readBody(request));
        const row = await book(auth, bookId);
        checkPage(input.page, row);
        const content = normalizeQuoteText(input.content);
        if (!content)
          throw new ApiError(400, input.content.trim() ? LENGTH_ERROR : '남길 문장을 적어 주세요.');
        const created = await storage.rest(
          auth,
          'book_quotes',
          {},
          { user_id: auth.userId, resource_id: row.id, page: input.page, content, note: cleanNote(input.note) },
          { headers: { Prefer: 'return=representation' } },
        );
        const saved = Array.isArray(created) ? (created[0] as QuoteRow | undefined) : undefined;
        return json({ quote: saved ? toQuote(saved) : null }, 201);
      } catch (error) {
        return fail(error);
      }
    },

    /** 쪽, 문장, 생각 중 보낸 것만 고친다. */
    async UPDATE(request: Request, bookId: string, quoteId: string) {
      try {
        const auth = await storage.authenticate(request);
        const input = change.parse(await readBody(request));
        const row = await book(auth, bookId);
        const patch: Record<string, unknown> = {};
        if (input.page !== undefined) {
          checkPage(input.page, row);
          patch.page = input.page;
        }
        if (input.content !== undefined) {
          const content = normalizeQuoteText(input.content);
          if (!content)
            throw new ApiError(400, input.content.trim() ? LENGTH_ERROR : '남길 문장을 적어 주세요.');
          patch.content = content;
        }
        if (input.note !== undefined) patch.note = cleanNote(input.note);
        const updated = await storage.rest(
          auth,
          'book_quotes',
          { id: `eq.${z.uuid().parse(quoteId)}`, resource_id: `eq.${row.id}`, user_id: `eq.${auth.userId}` },
          patch,
          { method: 'PATCH', headers: { Prefer: 'return=representation' } },
        );
        const saved = Array.isArray(updated) ? (updated[0] as QuoteRow | undefined) : undefined;
        if (!saved) throw new ApiError(404, '문장을 찾을 수 없어요.');
        return json({ quote: toQuote(saved) });
      } catch (error) {
        return fail(error);
      }
    },

    async REMOVE(request: Request, bookId: string, quoteId: string) {
      try {
        const auth = await storage.authenticate(request);
        const removed = await storage.rest(
          auth,
          'book_quotes',
          {
            id: `eq.${z.uuid().parse(quoteId)}`,
            resource_id: `eq.${z.uuid().parse(bookId)}`,
            user_id: `eq.${auth.userId}`,
          },
          undefined,
          { method: 'DELETE', headers: { Prefer: 'return=representation' } },
        );
        if (!Array.isArray(removed) || removed.length === 0) throw new ApiError(404, '문장을 찾을 수 없어요.');
        return json({ removed: true });
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function fail(error: unknown) {
  if (error instanceof z.ZodError) return json({ error: '쪽과 문장을 확인해 주세요.' }, 400);
  if (error instanceof ApiError)
    return json(
      { error: /[가-힣]/.test(error.message) ? error.message : '연결을 확인하고 다시 시도해 주세요.' },
      error.status,
    );
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 503);
}
