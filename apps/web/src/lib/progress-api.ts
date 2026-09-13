import { z } from 'zod';
import { addDays, toStudyDate } from '@paceon/scheduler';
import type { Resource, Plan, ProgressEvent, ScheduleSession } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { calculateProgressCandidate, parseProgressRequest, ProgressError } from './progress.ts';
import type { ProgressCandidate } from './progress.ts';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function createProgressHandler(config: Config | undefined, fetcher: typeof fetch = globalThis.fetch) {
  const storage = createWorkspaceHandlers(config, fetcher);
  return async (request: Request, resourceId: string): Promise<Response> => {
    try {
      const auth = await storage.authenticate(request);
      z.uuid().parse(resourceId);
      const input = parseProgressRequest(await readBody(request));
      const replay = async () => {
        const ledger = await storage.rows<{ resource_id: string; request: unknown; result: unknown }>(auth, 'progress_submissions', { idempotency_key: `eq.${input.idempotencyKey}` });
        if (!ledger[0]) return null;
        if (ledger[0].resource_id !== resourceId || canonical(ledger[0].request) !== canonical(input)) throw new ApiError(409, '같은 요청 번호에 다른 기록이 있습니다. 자료를 새로고침해 주세요.');
        return json(ledger[0].result);
      };
      const previous = await replay();
      if (previous) return previous;
      const [books, plans, events, preferences] = await Promise.all([
        storage.rows<Resource>(auth, 'resources', { id: `eq.${resourceId}`, type: 'eq.BOOK' }),
        storage.rows<Plan>(auth, 'plans', { status: 'in.(ACTIVE,PAUSED,COMPLETED)' }),
        storage.rows<ProgressEvent>(auth, 'progress_events', { resource_id: `eq.${resourceId}` }),
        storage.settings(auth),
      ]);
      const book = books[0];
      const plan = plans.find(p => p.id === input.planId && p.resource_id === resourceId);
      if (!book || !plan) throw new ApiError(404, '기록할 자료와 계획을 찾을 수 없습니다.');
      if (book.status === 'ARCHIVED' || plan.status === 'PAUSED') throw new ApiError(409, '현재 학습 중인 계획에서 기록해 주세요.');
      if (book.progress_version !== input.expectedProgressVersion || plan.version !== input.expectedPlanVersion) {
        const committed = await replay();
        if (committed) return committed;
        throw new ApiError(409, '다른 기록이나 계획 변경이 반영되었습니다. 새로고침 후 다시 입력해 주세요.');
      }
      const asOfDate = toStudyDate(new Date().toISOString(), plan.timezone);
      const nextDay = addDays(asOfDate, 1);
      const horizonEnd = addDays(plan.start_date > nextDay ? plan.start_date : nextDay, 3659);
      const [sessions, reserved] = await Promise.all([
        storage.rows<ScheduleSession>(auth, 'schedule_sessions', { plan_id: `eq.${plan.id}` }),
        storage.rows<ScheduleSession>(auth, 'schedule_sessions', { and: `(study_date.gt.${asOfDate},study_date.lte.${horizonEnd})`, resource_id: `neq.${resourceId}`, status: 'neq.SKIPPED' }),
      ]);
      const activeIds = new Set(plans.filter(p => p.status === 'ACTIVE' || p.status === 'PAUSED').map(p => p.id));
      let candidate: ProgressCandidate;
      try {
        candidate = calculateProgressCandidate({ book, plan, events, sessions, availability: preferences.availability, otherSessions: reserved.filter(s => activeIds.has(s.plan_id)), request: input, asOfDate });
      } catch (error) {
        if (error instanceof ProgressError) {
          // Parallel reads can observe old revisions and the committed retry's events.
          const committed = await replay();
          if (committed) return committed;
        }
        throw error;
      }
      const snapshot = [...sessions].sort((a, b) => a.id.localeCompare(b.id)).map(s => ({ id: s.id, study_date: s.study_date, start_page: s.start_page, end_page: s.end_page, estimated_minutes: s.estimated_minutes, status: s.status, is_locked: s.is_locked, plan_version: s.plan_version }));
      const result = await storage.rest(auth, 'rpc/submit_book_progress', {}, { p_resource_id: resourceId, p_request: input, p_candidate: candidate, p_expected_sessions: snapshot, p_expected_total: book.total_pages, p_expected_initial: book.initial_completed_workload, p_as_of_date: asOfDate });
      return json(result, 201);
    } catch (error) {
      if (error instanceof z.ZodError) return json({ error: '기록 날짜, 페이지와 소요시간을 확인해 주세요.' }, 400);
      if (error instanceof ProgressError) return json({ error: error.message }, error.code === 'CORRUPT_PROGRESS' ? 409 : 400);
      if (error instanceof ApiError) return json({ error: /[가-힣]/.test(error.message) ? error.message : error.status === 401 ? '다시 로그인해 주세요.' : '연결을 확인하고 다시 시도해 주세요.' }, error.status);
      return json({ error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도하거나 새로고침해 기록을 확인해 주세요.' }, 503);
    }
  };
}
