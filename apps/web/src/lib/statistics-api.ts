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
      const events = resources.length ? await workspace.rows<ProgressEvent>(auth, 'progress_events', {
        ...(query.resourceId ? { resource_id: `eq.${query.resourceId}` } : {}),
      }) : [];
      return json(buildStatistics({ resources, events, ...range, today, timezone }));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof RangeError) return json({ error: '오늘까지의 날짜를 최대 366일 범위로 선택해 주세요.' }, 400);
      if (error instanceof ProgressError) return json({ error: '학습 기록이 일치하지 않아 통계를 계산하지 못했어요. 자료의 기록을 확인해 주세요.' }, 409);
      return failure(error);
    }
  };
}
