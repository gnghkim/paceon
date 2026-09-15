import { z } from 'zod';
import { toStudyDate } from '@paceon/scheduler';
import type { LearnerProfile, ProgressEvent, Resource } from '@paceon/shared';
import { ApiError, failure, json } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { buildStatistics, statisticsRange } from './statistics.ts';
import { ProgressError } from './progress.ts';

const querySchema = z.object({ from: z.string().optional(), to: z.string().optional(), resourceId: z.uuid().optional() }).strict();

export function createStatisticsHandler(config: Config | undefined, fetcher: typeof fetch = globalThis.fetch, clock: () => Date = () => new Date()) {
  const workspace = createWorkspaceHandlers(config, fetcher);
  async function dailyMinutes(auth: Awaited<ReturnType<typeof workspace.authenticate>>, from: string, to: string): Promise<Record<string, number>> {
    let rows: unknown;
    try {
      rows = await workspace.rest(auth, 'rpc/learning_daily_minutes', {}, { p_from: from, p_to: to });
    } catch {
      throw new ApiError(503, '학습실 기록을 불러오지 못했어요. 같은 요청으로 다시 시도해 주세요.');
    }
    if (!Array.isArray(rows)) throw new ApiError(503, '학습실 기록을 불러오지 못했어요. 같은 요청으로 다시 시도해 주세요.');
    const result: Record<string, number> = {};
    for (const row of rows as { study_date?: unknown; minutes?: unknown }[]) {
      if (typeof row.study_date === 'string' && typeof row.minutes === 'number') result[row.study_date] = Math.round(row.minutes);
    }
    return result;
  }
  return async (request: Request): Promise<Response> => {
    try {
      const auth = await workspace.authenticate(request);
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new ApiError(400, '조회 조건을 확인해 주세요.');
      const query = querySchema.parse(Object.fromEntries(params));
      const profiles = await workspace.rows<LearnerProfile>(auth, 'learner_profiles', { order: 'user_id.asc' });
      const timezone = profiles[0]?.timezone ?? 'Asia/Seoul';
      const today = toStudyDate(clock().toISOString(), timezone);
      const range = statisticsRange(query.from, query.to, today);
      const resources = await workspace.rows<Resource>(auth, 'resources', {
        type: 'eq.BOOK', workload_unit: 'eq.PAGE', ...(query.resourceId ? { id: `eq.${query.resourceId}` } : {}),
      });
      if (query.resourceId && !resources.length) throw new ApiError(404, '자료를 찾을 수 없습니다.');
      // Full history is required: a later VOID can invalidate an earlier selected record.
      // Room minutes reflect the whole account regardless of resourceId: learning workspaces are not tied to a book.
      const [events, learningMinutesByDay] = await Promise.all([
        resources.length ? workspace.rows<ProgressEvent>(auth, 'progress_events', {
          ...(query.resourceId ? { resource_id: `eq.${query.resourceId}` } : {}),
        }) : Promise.resolve([]),
        dailyMinutes(auth, range.from, range.to),
      ]);
      return json(buildStatistics({ resources, events, learningMinutesByDay, ...range, today, timezone }));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof RangeError) return json({ error: '오늘까지의 날짜를 최대 366일 범위로 선택해 주세요.' }, 400);
      if (error instanceof ProgressError) return json({ error: '학습 기록이 일치하지 않아 통계를 계산하지 못했어요. 자료의 기록을 확인해 주세요.' }, 409);
      return failure(error);
    }
  };
}
