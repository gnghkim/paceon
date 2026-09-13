import { z } from 'zod';
import { aiRequestSchema, analysisSchema, coachSchema } from '@paceon/ai-schema';
import type { AiKind } from '@paceon/ai-schema';
import type { Plan, ProgressEvent, Resource, Tables } from '@paceon/shared';
import { toStudyDate } from '@paceon/scheduler';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { buildAiContext } from './ai-context.ts';
import type { AiJobView, AiJobsResponse } from './ai-types.ts';

type Job = Tables<'ai_jobs'>;
function view(job: Job): AiJobView {
  const parsed = job.kind === 'BOOK_ANALYSIS' ? analysisSchema.safeParse(job.result) : coachSchema.safeParse(job.result);
  const invalid = job.status === 'COMPLETED' && !parsed.success;
  return {
    id: job.id, kind: job.kind as AiKind, status: invalid ? 'FAILED' : job.status as AiJobView['status'],
    result: job.status === 'COMPLETED' && parsed.success ? parsed.data : null,
    model: job.model, errorCode: invalid ? 'INVALID_RESULT' : job.error_code,
    sourceRevision: job.source_revision, createdAt: job.created_at, updatedAt: job.updated_at,
  };
}
export function createAiHandlers(config: Config | undefined, enabled: boolean, fetcher: typeof fetch = globalThis.fetch) {
  const storage = createWorkspaceHandlers(config, fetcher);
  type Auth = Awaited<ReturnType<typeof storage.authenticate>>;
  async function db(auth: Auth, table: string, query: Record<string, string>, body?: unknown) {
    const url = new URL(`/rest/v1/${table}`, auth.base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetcher(url, { headers: { ...auth.headers, 'Content-Type': 'application/json' },
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    if (response.status === 401 || response.status === 403) throw new ApiError(401, '다시 로그인해 주세요.');
    if (response.status === 429) throw new ApiError(429, '진행 중인 분석이 많습니다. 완료된 뒤 다시 요청해 주세요.');
    if (!response.ok) throw new ApiError(503, 'AI 작업을 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    return response.json();
  }
  async function load(auth: Auth, resourceId: string) {
    z.uuid().parse(resourceId);
    const books = await storage.rows<Resource>(auth, 'resources', { id: `eq.${resourceId}`, type: 'eq.BOOK' });
    const book = books[0];
    if (!book) throw new ApiError(404, '자료를 찾을 수 없습니다.');
    const [plans, events, settings] = await Promise.all([
      storage.rows<Plan>(auth, 'plans', { resource_id: `eq.${resourceId}`, status: 'in.(ACTIVE,PAUSED,COMPLETED)', order: 'created_at.desc,id.desc' }),
      storage.rows<ProgressEvent>(auth, 'progress_events', { resource_id: `eq.${resourceId}` }),
      storage.settings(auth),
    ]);
    return { book, plan: plans[0] ?? null, events, today: toStudyDate(new Date().toISOString(), settings.timezone) };
  }
  async function jobs(auth: Auth, resourceId: string): Promise<Job[]> {
    // Keep both kinds represented even when one kind has a long retry history.
    const groups = await Promise.all((['BOOK_ANALYSIS', 'COACH'] as const).map(kind => db(auth, 'ai_jobs', {
      select: '*', user_id: `eq.${auth.userId}`, resource_id: `eq.${resourceId}`, kind: `eq.${kind}`, order: 'updated_at.desc,created_at.desc,id.desc', limit: '10',
    })));
    if (!groups.every(Array.isArray)) throw new ApiError(503, 'AI 기록을 불러오지 못했습니다.');
    return (groups.flat() as Job[]).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
  }
  function handle(error: unknown) {
    if (error instanceof z.ZodError) return json({ error: '분석 종류와 목차 길이를 확인해 주세요.' }, 400);
    if (error instanceof ApiError) return json({ error: /[가-힣]/.test(error.message) ? error.message : error.status === 401 ? '다시 로그인해 주세요.' : '요청을 처리하지 못했습니다.' }, error.status);
    return json({ error: 'AI 정보를 불러오지 못했습니다. 학습 기록과 일정은 계속 사용할 수 있습니다.' }, 503);
  }
  return {
    async GET(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        const state = await load(auth, resourceId);
        const history = await jobs(auth, resourceId);
        const latestInput = history.find(j => j.kind === 'BOOK_ANALYSIS')?.input;
        const outline = latestInput && typeof latestInput === 'object' && !Array.isArray(latestInput) && typeof latestInput.outline === 'string' ? latestInput.outline : '';
        const analysis = buildAiContext({ ...state, kind: 'BOOK_ANALYSIS', outline });
        const coach = buildAiContext({ ...state, kind: 'COACH', outline: '' });
        const result: AiJobsResponse = { available: enabled, sourceRevision: analysis.sourceRevision,
          sourceRevisions: { BOOK_ANALYSIS: analysis.sourceRevision, COACH: coach.sourceRevision }, jobs: history.map(view) };
        return json(result);
      } catch (error) { return handle(error); }
    },
    async POST(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        const input = aiRequestSchema.parse(await readBody(request, 65536));
        const state = await load(auth, resourceId);
        if (!enabled) throw new ApiError(503, 'AI 분석이 아직 연결되지 않았습니다. 학습 기록과 일정은 계속 사용할 수 있습니다.');
        if (state.book.status === 'ARCHIVED') throw new ApiError(409, '보관된 자료는 분석할 수 없습니다.');
        const context = buildAiContext({ ...state, kind: input.kind, outline: input.outline });
        const id = await db(auth, 'rpc/enqueue_ai_job', {}, { p_resource_id: resourceId, p_kind: input.kind, p_input: context, p_source_revision: context.sourceRevision });
        if (typeof id !== 'string') throw new ApiError(503, '분석 요청 상태를 확인하지 못했습니다.');
        const rows = await db(auth, 'ai_jobs', { select: '*', id: `eq.${id}`, user_id: `eq.${auth.userId}`, resource_id: `eq.${resourceId}` });
        if (!Array.isArray(rows) || !rows[0]) throw new ApiError(503, '분석 요청 상태를 확인하지 못했습니다.');
        const job = view(rows[0] as Job);
        return json({ job, sourceRevision: context.sourceRevision }, job.status === 'COMPLETED' ? 200 : 202);
      } catch (error) { return handle(error); }
    },
  };
}
