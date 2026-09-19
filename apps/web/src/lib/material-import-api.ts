import { z } from 'zod';
import type { AvailabilityRule, ScheduleSession, Tables } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { PageFetchError, fetchPublicPage, type FetchedPage } from './safe-fetch.ts';
import { decodeBody, extractPage, outlineRegion } from './page-text.ts';
import { parseOutline, summarizeOutline } from './unit-outline.ts';
import { fetchErrorText, fitPlan, freeMinutesByWeekday, readProposal } from './material-import.ts';

type ImportRow = Tables<'material_imports'>;

const start = z.object({ url: z.string().trim().min(1).max(2000) }).strict();

/** 글이 이보다 적으면 화면이 스크립트로 그려지는 페이지다. AI에게 넘겨도 찾을 것이 없다. */
const MIN_TEXT = 200;

/**
 * 링크를 주면 목차와 일정을 제안한다.
 *
 * 서버가 그 공개 페이지 하나를 읽어 글을 뽑고, 규칙으로 먼저 목차를 뽑아 바로 돌려준다.
 * AI가 켜져 있으면 같은 글을 Worker에 맡기고, 화면은 결과를 기다리는 동안 규칙으로 뽑은
 * 것을 이미 보여 줄 수 있다. 어느 쪽이든 제안일 뿐이고 저장은 사용자가 확인한 뒤에 한다.
 */
export function createMaterialImportHandlers(
  config: Config | undefined,
  aiEnabled: boolean,
  fetcher: typeof fetch = globalThis.fetch,
  fetchPage: (url: string) => Promise<FetchedPage> = fetchPublicPage,
) {
  const storage = createWorkspaceHandlers(config, fetcher);
  type Auth = Awaited<ReturnType<typeof storage.authenticate>>;

  async function freeMinutes(auth: Auth) {
    const preferences = await storage.settings(auth);
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: preferences.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    const sessions = await storage.rows<ScheduleSession>(auth, 'schedule_sessions', { study_date: `gt.${today}` });
    return freeMinutesByWeekday(preferences.availability as AvailabilityRule[], sessions, today);
  }

  return {
    async START(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = start.parse(await readBody(request));
        let fetched: FetchedPage;
        try {
          fetched = await fetchPage(input.url);
        } catch (error) {
          const reason = error instanceof PageFetchError ? error.reason : 'NETWORK';
          throw new ApiError(422, fetchErrorText[reason] ?? fetchErrorText.NETWORK!);
        }
        const page = extractPage(decodeBody(fetched.body, fetched.contentType));
        if (page.fullLength < MIN_TEXT)
          throw new ApiError(
            422,
            '페이지에서 글을 읽지 못했어요. 화면을 나중에 그리는 페이지이거나 로그인이 필요한 페이지일 수 있어요. 목차를 복사해 붙여 넣어 주세요.',
          );

        // 규칙으로 뽑은 것. AI가 꺼져 있거나 실패해도 이것은 남는다.
        // 페이지 전체가 아니라 목차 부분만 본다. 소개 문단과 후기가 챕터로 들어오면 안 된다.
        const ruled = parseOutline(outlineRegion(page.text));
        const fallback = summarizeOutline(ruled).units >= 2 ? ruled : [];
        const free = await freeMinutes(auth);

        let importId: string | null = null;
        if (aiEnabled) {
          const response = await fetcher(new URL('/rest/v1/material_imports', auth.base), {
            method: 'POST',
            headers: { ...auth.headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
            body: JSON.stringify({
              user_id: auth.userId,
              source_url: fetched.finalUrl.slice(0, 2000),
              page_title: page.title || null,
              input: page.text.slice(0, 60000),
              context: { freeMinutesByWeekday: free },
            }),
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
          if (response.status === 401 || response.status === 403)
            throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
          if (!response.ok) {
            const problem = (await response.json().catch(() => ({}))) as { message?: string };
            if (problem.message === 'IMPORT_LIMIT')
              throw new ApiError(429, '오늘은 링크로 가져오기를 많이 썼어요. 내일 다시 하거나 목차를 복사해 붙여 넣어 주세요.');
            // 줄을 세우지 못해도 규칙으로 뽑은 것은 돌려줄 수 있다.
            if (!fallback.length) throw new ApiError(503, '잠시 연결하지 못했습니다. 다시 시도해 주세요.');
          } else {
            const rows = (await response.json()) as { id: string }[];
            importId = rows[0]?.id ?? null;
          }
        }
        return json({ importId, sourceUrl: fetched.finalUrl, pageTitle: page.title, fallback, freeMinutesByWeekday: free }, 201);
      } catch (error) {
        return fail(error, '주소를 확인해 주세요.');
      }
    },

    /** AI의 정리가 끝났는지. 끝났으면 제안을 확인된 모양으로 돌려준다. */
    async STATUS(request: Request, id: string) {
      try {
        const auth = await storage.authenticate(request);
        z.uuid().parse(id);
        const [row] = await storage.rows<ImportRow>(auth, 'material_imports', {
          id: `eq.${id}`,
          select: 'id,status,result,error_code,context',
        });
        if (!row) throw new ApiError(404, '가져오기 요청을 찾을 수 없어요.');
        if (row.status === 'QUEUED' || row.status === 'RUNNING') return json({ status: 'PENDING' });
        if (row.status === 'FAILED') return json({ status: 'FAILED' });
        const proposal = readProposal(row.result);
        if (!proposal) return json({ status: 'NOT_FOUND' });
        const free = z.array(z.number().int().min(0).max(1440)).length(7).safeParse(
          (row.context as { freeMinutesByWeekday?: unknown } | null)?.freeMinutesByWeekday,
        );
        return json({
          status: 'READY',
          proposal: { ...proposal, plan: fitPlan(proposal.plan, proposal.units, free.success ? free.data : []) },
        });
      } catch (error) {
        return fail(error, '가져오기 요청을 확인해 주세요.');
      }
    },
  };
}

function fail(error: unknown, invalid: string) {
  if (error instanceof z.ZodError) return json({ error: invalid }, 400);
  if (error instanceof ApiError)
    return json(
      { error: /[가-힣]/.test(error.message) ? error.message : '연결을 확인하고 다시 시도해 주세요.' },
      error.status,
    );
  return json({ error: '잠시 후 다시 시도해 주세요.' }, 503);
}
