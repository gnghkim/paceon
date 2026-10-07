import { z } from 'zod';
import type { Tables } from '@paceon/shared';
import { ApiError, json } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { cardKey, deepLink, shapeTurn, validBotUsername, type CardStatus } from './telegram-tutor.ts';

type LinkRow = Tables<'telegram_links'>;
type TurnRow = Tables<'telegram_turns'>;

const PAGE = 20;
const cursor = z.iso.datetime({ offset: true });

/**
 * 웹 쪽 텔레그램 튜터: 연결 상태, 연결 코드, 연결 해제, 대화 보기.
 * 모두 로그인한 사람의 권한(RLS)으로 부른다. 텔레그램 ID와 chat ID는 화면에 보내지 않는다.
 */
export function createTelegramHandlers(
  config: Config | undefined,
  botUsername: string | null | undefined = process.env.TELEGRAM_BOT_USERNAME,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const storage = createWorkspaceHandlers(config, fetcher);
  const bot = validBotUsername(botUsername);
  type Auth = Awaited<ReturnType<typeof storage.authenticate>>;

  async function link(auth: Auth): Promise<LinkRow | null> {
    const rows = await storage.rows<LinkRow>(auth, 'telegram_links', { order: 'user_id.asc' });
    return rows[0] ?? null;
  }

  return {
    async STATUS(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const row = await link(auth);
        if (!row) return json({ linked: false, botUsername: bot });
        return json({
          linked: true,
          botUsername: bot,
          linkedAt: row.linked_at,
          level: row.level,
          voiceReplies: row.voice_replies,
          reviewAt: row.review_at.slice(0, 5),
        });
      } catch (error) {
        return fail(error);
      }
    },

    /** 일회용 코드. 평문은 이 응답에만 있고 서버에는 해시만 남는다. */
    async CODE(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const response = await fetcher(new URL('/rest/v1/rpc/create_telegram_link_code', auth.base), {
          method: 'POST',
          headers: { ...auth.headers, 'Content-Type': 'application/json' },
          body: '{}',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
        if (response.status === 401 || response.status === 403)
          throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
        if (!response.ok) {
          const problem = (await response.json().catch(() => ({}))) as { message?: string };
          if (problem.message === 'LINK_CODE_LIMIT')
            throw new ApiError(429, '연결 코드를 너무 여러 번 받았어요. 한 시간 뒤에 다시 받아 주세요.');
          throw new ApiError(503, '연결 코드를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
        }
        const issued = z.object({ code: z.string(), expiresAt: z.string() }).parse(await response.json());
        return json({ ...issued, botUsername: bot, deepLink: deepLink(bot, issued.code) }, 201);
      } catch (error) {
        return fail(error);
      }
    },

    async UNLINK(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const unlinked = await storage.rest(auth, 'rpc/unlink_telegram', {}, {});
        return json({ unlinked: unlinked === true });
      } catch (error) {
        return fail(error);
      }
    },

    /** 대화를 최근 것부터 한 쪽씩. 다음 쪽은 이 쪽의 마지막 시각보다 앞선 것이다. */
    async TURNS(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const before = new URL(request.url).searchParams.get('before');
        if (before !== null && !cursor.safeParse(before).success)
          throw new ApiError(400, '불러올 위치를 확인해 주세요.');
        const [rows, cards, row, preferences] = await Promise.all([
          storage.rest(auth, 'telegram_turns', {
            select: 'id,input_kind,learner_text,reply_text,tutor_turn,mistake_count,rewrite_attempt,rewrite_correct,created_at',
            user_id: `eq.${auth.userId}`,
            order: 'created_at.desc,id.desc',
            limit: String(PAGE + 1),
            ...(before ? { created_at: `lt.${before}` } : {}),
          }) as Promise<TurnRow[]>,
          storage.rows<Pick<Tables<'learning_expressions'>, 'wrong_text' | 'correct_text' | 'due_on' | 'review_count' | 'occurrences'>>(
            auth, 'learning_expressions',
            { select: 'id,wrong_text,correct_text,due_on,review_count,occurrences', kind: 'eq.CORRECTION' },
          ),
          link(auth),
          storage.settings(auth),
        ]);
        if (!Array.isArray(rows)) throw new ApiError(503, '대화를 불러오지 못했어요.');
        const status = new Map<string, CardStatus>();
        for (const card of cards)
          if (card.wrong_text && card.correct_text)
            status.set(cardKey(card.wrong_text, card.correct_text), {
              dueOn: card.due_on, reviewCount: card.review_count, occurrences: card.occurrences,
            });
        const page = rows.slice(0, PAGE).map(turn => shapeTurn(turn, status, preferences.timezone));
        return json({
          linked: row !== null,
          timezone: preferences.timezone,
          turns: page,
          nextBefore: rows.length > PAGE ? page.at(-1)!.createdAt : null,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };
}

function fail(error: unknown) {
  if (error instanceof z.ZodError) return json({ error: '응답을 확인하지 못했어요.' }, 503);
  if (error instanceof ApiError)
    return json({ error: /[가-힣]/.test(error.message) ? error.message : error.status === 401 ? '다시 로그인해 주세요.' : '연결을 확인하고 다시 시도해 주세요.' }, error.status);
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 503);
}
