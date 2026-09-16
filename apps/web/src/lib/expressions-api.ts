import { z } from 'zod';
import { toStudyDate } from '@paceon/scheduler';
import type { Tables } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import {
  DAILY_REVIEW_SIZE,
  dueToday,
  firstReview,
  nextReview,
  type ExpressionCard,
} from './expression-review.ts';

type ExpressionRow = Tables<'learning_expressions'>;

/**
 * 뜻을 적으면 그대로 저장하고, 비우면 AI가 채우도록 줄을 세운다.
 * 단어장에서 단어만 적어 넣는 경우가 뒤쪽이다.
 */
const save = z
  .object({
    phrase: z.string().trim().min(1).max(200),
    meaning: z.string().trim().max(500).optional(),
    example: z.string().trim().max(1000).nullable().optional(),
    workspaceId: z.uuid().nullable().optional(),
  })
  .strict();

const review = z
  .object({ id: z.uuid(), grade: z.enum(['HARD', 'OK', 'EASY']) })
  .strict();

/** 화면에 필요한 것만 추린다. 저장 시각, 출처 공간 ID, 임대 정보는 보내지 않는다. */
const toCard = (row: ExpressionRow): ExpressionCard => ({
  id: row.id,
  phrase: row.phrase,
  meaning: row.meaning ?? '',
  examples: row.examples ?? [],
  review_step: row.review_step,
  due_on: row.due_on,
  lookup: row.lookup_status === 'QUEUED' || row.lookup_status === 'RUNNING'
    ? 'PENDING'
    : row.lookup_status === 'FAILED'
      ? 'FAILED'
      : 'DONE',
});

export function createExpressionHandlers(
  config: Config | undefined,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const storage = createWorkspaceHandlers(config, fetcher);

  async function today(auth: Awaited<ReturnType<typeof storage.authenticate>>) {
    const { timezone } = await storage.settings(auth);
    return toStudyDate(new Date().toISOString(), timezone);
  }

  return {
    /** 오늘 물어볼 카드와 저장한 표현 수. 밀린 개수는 세어 보내지 않는다. */
    async GET(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const [rows, day] = await Promise.all([
          storage.rows<ExpressionRow>(auth, 'learning_expressions'),
          today(auth),
        ]);
        const cards = rows.map(toCard);
        const url = new URL(request.url);
        const all = url.searchParams.get('all') === 'true';
        // 뜻이 아직 없는 카드는 복습에 내보내지 않는다. 물어볼 답이 없다.
        const reviewable = cards.filter(card => card.lookup === 'DONE');
        return json({
          today: day,
          saved: cards.length,
          due: dueToday(reviewable, day, DAILY_REVIEW_SIZE).length,
          pending: cards.filter(card => card.lookup === 'PENDING').length,
          cards: all
            ? cards.sort(
                (a, b) =>
                  b.due_on.localeCompare(a.due_on) || a.phrase.localeCompare(b.phrase),
              )
            : dueToday(reviewable, day, DAILY_REVIEW_SIZE),
        });
      } catch (error) {
        return fail(error, '표현을 불러오지 못했어요.');
      }
    },

    /** 표현 하나를 저장한다. 이미 있으면 합치지 않고 있다고 알린다. */
    async POST(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = save.parse(await readBody(request));
        const day = await today(auth);
        const start = firstReview(day);
        const typed = (input.meaning ?? '').trim();
        try {
          const created = await storage.rest(
            auth,
            'learning_expressions',
            {},
            {
              user_id: auth.userId,
              phrase: input.phrase,
              // 뜻을 적지 않았으면 AI가 채울 때까지 비워 두고 줄을 세운다.
              meaning: typed || null,
              examples: input.example ? [input.example] : [],
              lookup_status: typed ? 'NONE' : 'QUEUED',
              source_workspace_id: input.workspaceId ?? null,
              review_step: start.step,
              due_on: start.dueOn,
            },
            { headers: { Prefer: 'return=representation' } },
          );
          const row = Array.isArray(created) ? (created[0] as ExpressionRow) : null;
          return json({ card: row ? toCard(row) : null }, 201);
        } catch (error) {
          // 같은 표현은 유일 제약에 걸린다. 저장 계층은 이를 409로 바꿔 준다.
          if (error instanceof ApiError && error.status === 409)
            return json({ error: '이미 저장한 표현이에요.', duplicate: true }, 409);
          throw error;
        }
      } catch (error) {
        return fail(error, '표현과 뜻을 확인해 주세요.');
      }
    },

    /** 답한 결과를 기록하고 다음 예정일을 정한다. */
    async PATCH(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = review.parse(await readBody(request));
        const [rows, day] = await Promise.all([
          storage.rows<ExpressionRow>(auth, 'learning_expressions', { id: `eq.${input.id}` }),
          today(auth),
        ]);
        const current = rows[0];
        if (!current) throw new ApiError(404, '표현을 찾을 수 없어요.');
        const next = nextReview(current.review_step, input.grade, day);
        const updated = await storage.rest(
          auth,
          'rpc/record_expression_review',
          {},
          { p_id: input.id, p_step: next.step, p_due_on: next.dueOn, p_today: day },
        );
        return json({ card: updated ? toCard(updated as ExpressionRow) : null, nextDueOn: next.dueOn });
      } catch (error) {
        return fail(error, '복습 결과를 확인해 주세요.');
      }
    },

    /** 표현을 지운다. 지운 표현은 복습에 다시 나오지 않는다. */
    async DELETE(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = z.object({ id: z.uuid() }).strict().parse(await readBody(request));
        await storage.rest(
          auth,
          'learning_expressions',
          { id: `eq.${input.id}`, user_id: `eq.${auth.userId}` },
          undefined,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        );
        return json({ deleted: true });
      } catch (error) {
        return fail(error, '지울 표현을 확인해 주세요.');
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
