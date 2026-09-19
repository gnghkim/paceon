import { z } from 'zod';
import { toStudyDate } from '@paceon/scheduler';
import type { Resource, Tables } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { firstReview } from './expression-review.ts';
import { MAX_RECALL_LENGTH, normalizeRecall, recallPrompt, validRange } from './recall.ts';

type CardRow = Tables<'learning_expressions'>;

const save = z
  .object({
    resourceId: z.uuid(),
    content: z.string().max(MAX_RECALL_LENGTH * 4),
    startPage: z.number().int().optional(),
    endPage: z.number().int().optional(),
    /** 챕터로 공부하는 자료에서는 쪽 범위 대신 챕터를 가리킨다. */
    unitId: z.uuid().optional(),
  })
  .strict();

export interface RecallNote {
  id: string;
  content: string;
  startPage: number | null;
  endPage: number | null;
  unitId: string | null;
  createdOn: string;
  dueOn: string;
  reviewCount: number;
}

/** 책 화면에 필요한 것만 추린다. 간격의 위치나 임대 정보는 보내지 않는다. */
const toNote = (row: CardRow): RecallNote => ({
  id: row.id,
  content: row.meaning ?? '',
  startPage: row.start_page,
  endPage: row.end_page,
  unitId: row.unit_id,
  createdOn: row.created_at.slice(0, 10),
  dueOn: row.due_on,
  reviewCount: row.review_count,
});

/**
 * 독서 회상 카드. 저장하면 다음 날부터 복습에 나온다.
 * 복습과 삭제는 표현과 같은 길(/api/learning/expressions)을 쓴다. 같은 표이기 때문이다.
 */
export function createRecallHandlers(
  config: Config | undefined,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const storage = createWorkspaceHandlers(config, fetcher);

  return {
    /** 한 책에서 떠올려 적은 것들. 최근 것이 먼저다. */
    async GET(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const resourceId = z.uuid().parse(new URL(request.url).searchParams.get('resourceId'));
        const rows = await storage.rows<CardRow>(auth, 'learning_expressions', {
          kind: 'eq.RECALL',
          resource_id: `eq.${resourceId}`,
          order: 'created_at.desc,id.asc',
        });
        return json({ notes: rows.map(toNote) });
      } catch (error) {
        return fail(error, '책을 확인해 주세요.');
      }
    },

    async POST(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = save.parse(await readBody(request));
        const content = normalizeRecall(input.content);
        if (!content) throw new ApiError(400, `기억나는 것을 ${MAX_RECALL_LENGTH}자 안으로 적어 주세요.`);
        // 앞면에 쓸 제목은 서버가 자기 책에서 읽는다. 보낸 제목을 믿지 않는다.
        const [book] = await storage.rows<Resource>(auth, 'resources', { id: `eq.${input.resourceId}` });
        if (!book) throw new ApiError(404, '책을 찾을 수 없어요.');
        const range = input.unitId ? null : validRange(input.startPage, input.endPage);
        // 챕터 이름도 서버가 자기 자료에서 읽는다. 남의 챕터를 가리키면 찾지 못한다.
        let unitTitle: string | undefined;
        if (input.unitId) {
          const [unit] = await storage.rows<{ id: string; title: string }>(auth, 'resource_units', {
            select: 'id,title',
            id: `eq.${input.unitId}`,
            resource_id: `eq.${book.id}`,
          });
          if (!unit) throw new ApiError(404, '챕터를 찾을 수 없어요.');
          unitTitle = unit.title;
        }
        const { timezone } = await storage.settings(auth);
        const start = firstReview(toStudyDate(new Date().toISOString(), timezone));
        const created = await storage.rest(
          auth,
          'learning_expressions',
          {},
          {
            user_id: auth.userId,
            kind: 'RECALL',
            resource_id: book.id,
            start_page: range?.startPage ?? null,
            end_page: range?.endPage ?? null,
            unit_id: input.unitId ?? null,
            phrase: recallPrompt(book.title, range, unitTitle),
            meaning: content,
            review_step: start.step,
            due_on: start.dueOn,
          },
          { headers: { Prefer: 'return=representation' } },
        );
        const row = Array.isArray(created) ? (created[0] as CardRow) : null;
        return json({ note: row ? toNote(row) : null }, 201);
      } catch (error) {
        return fail(error, '적은 내용과 책을 확인해 주세요.');
      }
    },
  };
}

function fail(error: unknown, invalid: string) {
  if (error instanceof z.ZodError) return json({ error: invalid }, 400);
  if (error instanceof ApiError)
    return json(
      {
        error: /[가-힣]/.test(error.message)
          ? error.message
          : '연결을 확인하고 다시 시도해 주세요.',
      },
      error.status,
    );
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 503);
}
