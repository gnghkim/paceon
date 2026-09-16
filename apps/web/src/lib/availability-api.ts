import { z } from 'zod';
import { toStudyDate } from '@paceon/scheduler';
import type { Plan, ProgressEvent, Resource, ScheduleSession } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { calculateProgressCandidate, ProgressError } from './progress.ts';

const rule = z.object({
  isoWeekday: z.number().int().min(1).max(7),
  availableMinutes: z.number().int().min(1).max(1440),
});
const schema = z
  .object({ rules: z.array(rule).min(1).max(7) })
  .strict()
  .refine(
    value => new Set(value.rules.map(item => item.isoWeekday)).size === value.rules.length,
    '같은 요일을 두 번 넣을 수 없습니다.',
  );

/**
 * 한 세션이 재계획으로 옮겨질 수 있는지.
 * 지난 날짜, 완료·진행 중, 고정, 실제 기록이 달린 세션은 그대로 둔다.
 * 판단 기준은 submit_book_progress가 eligible을 고르는 조건과 같아야 한다.
 */
export function isMovable(
  session: Pick<ScheduleSession, 'id' | 'study_date' | 'status' | 'is_locked'>,
  asOfDate: string,
  referenced: ReadonlySet<string>,
) {
  return (
    session.study_date > asOfDate &&
    (session.status === 'PLANNED' || session.status === 'SKIPPED') &&
    !session.is_locked &&
    !referenced.has(session.id)
  );
}

export interface AvailabilityConflict {
  resourceId: string;
  title: string;
  code: string;
}

/**
 * 학습 가능한 요일과 시간을 바꾼다.
 *
 * 여러 책이 같은 주간 예산을 나눠 쓰므로 한 권씩 따로 고칠 수 없다. 먼저 모든 진행 중인
 * 계획을 새 예산으로 다시 계산해 보고, 한 권이라도 들어가지 않으면 아무것도 쓰지 않고
 * 어느 책이 걸리는지 알린다. 통과하면 예산을 바꾸고, 옮길 수 있는 앞으로의 일정을 비운
 * 뒤 계획을 하나씩 다시 채운다. 비우는 단계가 필요한 이유는 계획별 저장 함수가 다른 책의
 * 현재 일정을 그대로 예약된 시간으로 세기 때문이다.
 */
export function createAvailabilityHandler(
  config: Config | undefined,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const storage = createWorkspaceHandlers(config, fetcher);
  return async (request: Request): Promise<Response> => {
    try {
      const auth = await storage.authenticate(request);
      const input = schema.parse(await readBody(request));
      const [books, plans, events, preferences] = await Promise.all([
        storage.rows<Resource>(auth, 'resources', { type: 'eq.BOOK' }),
        storage.rows<Plan>(auth, 'plans', { status: 'in.(ACTIVE,PAUSED,COMPLETED)' }),
        storage.rows<ProgressEvent>(auth, 'progress_events'),
        storage.settings(auth),
      ]);
      const unchanged =
        preferences.availability.length === input.rules.length &&
        input.rules.every(item =>
          preferences.availability.some(
            saved =>
              saved.iso_weekday === item.isoWeekday &&
              saved.available_minutes === item.availableMinutes,
          ),
        );
      if (unchanged) return json({ rules: input.rules, rescheduled: [], needsAttention: [] });

      // 멈춘 계획도 시간을 예약하므로 함께 다시 계산한다. 보관한 책은 재계획할 수 없다.
      const live = plans
        .filter(plan => plan.status === 'ACTIVE' || plan.status === 'PAUSED')
        .map(plan => ({ plan, book: books.find(item => item.id === plan.resource_id) }))
        .filter(
          (entry): entry is { plan: Plan; book: Resource } =>
            !!entry.book && entry.book.status !== 'ARCHIVED',
        )
        // 우선순위는 먼저 시작한 계획 순으로 고정한다. 같은 입력에 같은 결과가 나와야 한다.
        .sort(
          (a, b) =>
            a.plan.start_date.localeCompare(b.plan.start_date) ||
            a.plan.created_at.localeCompare(b.plan.created_at) ||
            a.plan.id.localeCompare(b.plan.id),
        );
      const referenced = new Set(
        events.map(event => event.session_id).filter((id): id is string => !!id),
      );
      const allSessions = await storage.rows<ScheduleSession>(auth, 'schedule_sessions');

      type Prepared = {
        plan: Plan;
        book: Resource;
        asOfDate: string;
        fixed: ScheduleSession[];
        movable: ScheduleSession[];
      };
      const prepared: Prepared[] = live.map(({ plan, book }) => {
        const asOfDate = toStudyDate(new Date().toISOString(), plan.timezone);
        const mine = allSessions.filter(session => session.plan_id === plan.id);
        return {
          plan,
          book,
          asOfDate,
          fixed: mine.filter(session => !isMovable(session, asOfDate, referenced)),
          movable: mine.filter(session => isMovable(session, asOfDate, referenced)),
        };
      });

      /**
       * 한 권을 새 예산으로 계산한다. 앞선 책이 이미 차지한 시간과,
       * 모든 책의 옮기지 않는 일정을 예약된 시간으로 넘긴다.
       */
      const planFor = (
        entry: Prepared,
        sessions: readonly ScheduleSession[],
        taken: readonly { study_date: string; estimated_minutes: number | null }[],
      ) =>
        calculateProgressCandidate({
          book: entry.book,
          plan: { ...entry.plan, minutes_per_page: Number(entry.plan.minutes_per_page) },
          events: events.filter(event => event.resource_id === entry.book.id),
          sessions,
          availability: input.rules.map(item => ({
            iso_weekday: item.isoWeekday,
            available_minutes: item.availableMinutes,
          })),
          otherSessions: [
            ...prepared
              .filter(other => other.plan.id !== entry.plan.id)
              .flatMap(other =>
                other.fixed.filter(
                  session =>
                    session.study_date > entry.asOfDate && session.status !== 'SKIPPED',
                ),
              ),
            ...taken,
          ],
          request: {
            kind: 'REPLAN',
            idempotencyKey: crypto.randomUUID(),
            planId: entry.plan.id,
            expectedPlanVersion: entry.plan.version,
            expectedProgressVersion: entry.book.progress_version,
          },
          asOfDate: entry.asOfDate,
        });

      // 1단계: 아무것도 쓰지 않고 전부 들어가는지 확인한다.
      const conflicts: AvailabilityConflict[] = [];
      const dryTaken: { study_date: string; estimated_minutes: number | null }[] = [];
      for (const entry of prepared) {
        let candidate;
        try {
          candidate = planFor(entry, entry.fixed, dryTaken);
        } catch (error) {
          if (error instanceof ProgressError) {
            conflicts.push({
              resourceId: entry.book.id,
              title: entry.book.title,
              code: 'INVALID_INPUT',
            });
            continue;
          }
          throw error;
        }
        if (candidate.schedule.status === 'conflict') {
          conflicts.push({
            resourceId: entry.book.id,
            title: entry.book.title,
            code: candidate.schedule.conflicts[0]?.code ?? 'TIME_CAPACITY',
          });
          continue;
        }
        for (const session of candidate.schedule.sessions)
          dryTaken.push({
            study_date: session.studyDate,
            estimated_minutes: session.estimatedMinutes,
          });
      }
      if (conflicts.length)
        return json(
          {
            error:
              '새 학습 시간에 모든 책을 담지 못했어요. 시간을 늘리거나 아래 책의 하루 분량과 목표 날짜를 먼저 바꿔 주세요.',
            conflicts,
          },
          409,
        );

      // 2단계: 예산을 바꾸고, 옮길 수 있는 앞으로의 일정을 비운다.
      await storage.rest(auth, 'rpc/replace_availability_rules', {}, { p_rules: input.rules });
      const movableIds = prepared.flatMap(entry => entry.movable.map(session => session.id));
      if (movableIds.length)
        await storage.rest(
          auth,
          'schedule_sessions',
          { id: `in.(${movableIds.join(',')})`, user_id: `eq.${auth.userId}` },
          undefined,
          { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
        );

      // 3단계: 한 권씩 다시 채운다. 실패한 책은 기존 일정을 잃은 채 남으므로 표시해 알린다.
      const rescheduled: string[] = [];
      const needsAttention: AvailabilityConflict[] = [];
      const taken: { study_date: string; estimated_minutes: number | null }[] = [];
      for (const entry of prepared) {
        try {
          const candidate = planFor(entry, entry.fixed, taken);
          if (candidate.schedule.status === 'conflict') throw new Error('conflict');
          const snapshot = [...entry.fixed]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(session => ({
              id: session.id,
              study_date: session.study_date,
              start_page: session.start_page,
              end_page: session.end_page,
              estimated_minutes: session.estimated_minutes,
              status: session.status,
              is_locked: session.is_locked,
              plan_version: session.plan_version,
            }));
          await storage.rest(
            auth,
            'rpc/submit_book_progress',
            {},
            {
              p_resource_id: entry.book.id,
              p_request: {
                kind: 'REPLAN',
                idempotencyKey: crypto.randomUUID(),
                planId: entry.plan.id,
                expectedPlanVersion: entry.plan.version,
                expectedProgressVersion: entry.book.progress_version,
              },
              p_candidate: candidate,
              p_expected_sessions: snapshot,
              p_expected_total: entry.book.total_pages,
              p_expected_initial: entry.book.initial_completed_workload,
              p_as_of_date: entry.asOfDate,
            },
          );
          for (const session of candidate.schedule.sessions)
            taken.push({
              study_date: session.studyDate,
              estimated_minutes: session.estimatedMinutes,
            });
          rescheduled.push(entry.book.title);
        } catch {
          // 이 책만 새 일정을 받지 못했다. 사용자가 상세에서 바로 고칠 수 있게 표시한다.
          await storage
            .rest(
              auth,
              'resources',
              { id: `eq.${entry.book.id}`, user_id: `eq.${auth.userId}` },
              { replan_required: true },
              { method: 'PATCH', headers: { Prefer: 'return=minimal' } },
            )
            .catch(() => {});
          needsAttention.push({
            resourceId: entry.book.id,
            title: entry.book.title,
            code: 'REPLAN_FAILED',
          });
        }
      }
      return json({ rules: input.rules, rescheduled, needsAttention });
    } catch (error) {
      if (error instanceof z.ZodError)
        return json(
          { error: '학습할 요일을 하나 이상 고르고 시간을 1분에서 1440분 사이로 정해 주세요.' },
          400,
        );
      if (error instanceof ProgressError) return json({ error: error.message }, 400);
      if (error instanceof ApiError)
        return json(
          {
            error: /[가-힣]/.test(error.message)
              ? error.message
              : '연결을 확인하고 다시 시도해 주세요.',
          },
          error.status,
        );
      return json(
        { error: '학습 시간을 바꾸지 못했어요. 새로고침 후 계획을 확인해 주세요.' },
        503,
      );
    }
  };
}
