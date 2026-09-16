import { z } from 'zod';
import { addDays, toStudyDate } from '@paceon/scheduler';
import type {
  Resource,
  Plan,
  ScheduleSession,
  AvailabilityRule,
  LearnerProfile,
  ProgressEvent,
  ReplanRun,
} from '@paceon/shared';
import {
  ApiError,
  json,
  failure,
  readBody,
  createBookHandlers,
} from './books-api.ts';
import type { Config } from './books-api.ts';
import { parsePlanOptions, createInitialSchedule } from './planning.ts';
import type { WorkspaceData } from './workspace-types.ts';
import { projectProgress, ProgressError } from './progress.ts';

const uuid = z.uuid();
export function createWorkspaceHandlers(
  config: Config | undefined,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const authenticate = createBookHandlers(config, fetcher).authenticate;
  type Auth = Awaited<ReturnType<typeof authenticate>>;
  async function rest(
    auth: Auth,
    table: string,
    query: Record<string, string> = {},
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const url = new URL(`/rest/v1/${table}`, auth.base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetcher(url, {
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      ...(body === undefined
        ? {}
        : { method: 'POST', body: JSON.stringify(body) }),
    });
    if (response.status === 401 || response.status === 403)
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    if (!response.ok) {
      if (response.status === 409 || response.status === 400)
        throw new ApiError(
          409,
          '자료나 학습 시간이 변경되었습니다. 새로고침 후 계획을 다시 확인해 주세요.',
        );
      throw new ApiError(503, '잠시 연결하지 못했습니다. 다시 시도해 주세요.');
    }
    // A minimal-return write answers 204 with no body.
    return response.status === 204 ? null : response.json();
  }
  async function rows<T>(
    auth: Auth,
    table: string,
    query: Record<string, string> = {},
  ): Promise<T[]> {
    const result: T[] = [];
    for (let offset = 0; offset < 20_000; offset += 500) {
      const data: unknown = await rest(auth, table, {
        select: '*',
        user_id: `eq.${auth.userId}`,
        order: 'id.asc',
        ...query,
        limit: '500',
        offset: String(offset),
      });
      if (!Array.isArray(data))
        throw new ApiError(503, '자료를 불러오지 못했습니다.');
      result.push(...(data as T[]));
      if (data.length < 500) return result;
    }
    throw new ApiError(503, '한 번에 불러올 수 있는 범위를 초과했습니다.');
  }
  async function settings(auth: Auth) {
    const [availability, profiles] = await Promise.all([
      rows<AvailabilityRule>(auth, 'availability_rules'),
      rows<LearnerProfile>(auth, 'learner_profiles', { order: 'user_id.asc' }),
    ]);
    return {
      availability,
      timezone: profiles[0]?.timezone ?? 'Asia/Seoul',
      dailyLearningMinutes: profiles[0]?.daily_learning_minutes ?? null,
    };
  }
  /** Writes only the goal so a stale client cannot overwrite the shared timezone. */
  async function saveLearningGoal(auth: Auth, minutes: number | null) {
    await rest(
      auth,
      'learner_profiles',
      { on_conflict: 'user_id' },
      { user_id: auth.userId, daily_learning_minutes: minutes },
      { Prefer: 'resolution=merge-duplicates,return=minimal' },
    );
  }
  function handle(error: unknown) {
    if (error instanceof ProgressError) return json({ error: error.message }, 409);
    if (error instanceof z.ZodError || error instanceof RangeError)
      return json(
        { error: '날짜, 분량과 학습 가능 시간을 확인해 주세요.' },
        400,
      );
    return failure(error);
  }
  return {
    authenticate,
    rest,
    rows,
    settings,
    saveLearningGoal,
    async GET(request: Request) {
      try {
        const auth = await authenticate(request);
        const preferences = await settings(auth);
        const today = toStudyDate(
          new Date().toISOString(),
          preferences.timezone,
        );
        const url = new URL(request.url);
        const from = addDays(
          url.searchParams.get('from') ?? addDays(today, -7),
          0,
        );
        const to = addDays(url.searchParams.get('to') ?? addDays(today, 35), 0);
        if (from > to || to > addDays(from, 92))
          throw new ApiError(400, '조회 기간은 93일 이내로 선택해 주세요.');
        const id = url.searchParams.get('resourceId');
        if (id) uuid.parse(id);
        const [resources, plans, sessions, events, replans] = await Promise.all([
          rows<Resource>(auth, 'resources', {
            type: 'eq.BOOK',
            ...(id ? { id: `eq.${id}` } : {}),
          }),
          rows<Plan>(auth, 'plans', {
            status: 'in.(ACTIVE,PAUSED,COMPLETED)',
            ...(id ? { resource_id: `eq.${id}` } : {}),
          }),
          rows<ScheduleSession>(auth, 'schedule_sessions', {
            and: `(study_date.gte.${from},study_date.lte.${to})`,
            ...(id ? { resource_id: `eq.${id}` } : {}),
          }),
          rows<ProgressEvent>(auth, 'progress_events', { ...(id ? { resource_id: `eq.${id}` } : {}) }),
          rows<ReplanRun>(auth, 'replan_runs', { ...(id ? { resource_id: `eq.${id}` } : {}) }),
        ]);
        if (id && !resources.length)
          throw new ApiError(404, '자료를 찾을 수 없습니다.');
        const active = new Set(
          plans.filter((p) => p.status === 'ACTIVE').map((p) => p.id),
        );
        const data: WorkspaceData = {
          resources,
          plans: plans.sort((a, b) => b.created_at.localeCompare(a.created_at)),
          progress: Object.fromEntries(resources.map(book => {
            const projection = projectProgress(book, events.filter(event => event.resource_id === book.id));
            return [book.id, { completedThroughPage: projection.completedThroughPage, percent: projection.percent, latestLearningId: projection.latestLearningId }];
          })),
          events,
          replans,
          sessions: sessions
            .filter((s) => active.has(s.plan_id))
            .sort(
              (a, b) =>
                a.study_date.localeCompare(b.study_date) ||
                a.id.localeCompare(b.id),
            ),
          ...preferences,
          today,
          from,
          to,
        };
        return json(data);
      } catch (error) {
        return handle(error);
      }
    },
    async PROFILE(request: Request) {
      try {
        const auth = await authenticate(request);
        const input = z
          .object({
            dailyLearningMinutes: z
              .number()
              .int()
              .min(1)
              .max(1440)
              .nullable(),
          })
          .strict()
          .parse(await readBody(request));
        await saveLearningGoal(auth, input.dailyLearningMinutes);
        return json({ dailyLearningMinutes: input.dailyLearningMinutes });
      } catch (error) {
        if (error instanceof z.ZodError)
          return json(
            { error: '목표 시간은 1분에서 1440분 사이로 정해 주세요.' },
            400,
          );
        return handle(error);
      }
    },
    async PLAN(request: Request, resourceId: string) {
      try {
        const auth = await authenticate(request);
        uuid.parse(resourceId);
        const input = z
          .object({ options: z.unknown(), preview: z.boolean().default(false) })
          .parse(await readBody(request));
        const options = parsePlanOptions(input.options);
        if (
          options.startDate <
          toStudyDate(new Date().toISOString(), options.timezone)
        )
          throw new ApiError(400, '시작일은 오늘 이후로 선택해 주세요.');
        const [resources, plans, preferences] = await Promise.all([
          rows<Resource>(auth, 'resources', {
            id: `eq.${resourceId}`,
            type: 'eq.BOOK',
          }),
          rows<Plan>(auth, 'plans', { status: 'in.(ACTIVE,PAUSED)' }),
          settings(auth),
        ]);
        const book = resources[0];
        if (!book) throw new ApiError(404, '자료를 찾을 수 없습니다.');
        if (
          book.status !== 'ACTIVE' ||
          book.initial_completed_workload >= (book.total_pages ?? 0)
        )
          throw new ApiError(409, '학습할 분량이 남아 있지 않습니다.');
        if (plans.some((p) => p.resource_id === resourceId))
          throw new ApiError(409, '이미 계획이 있는 자료입니다.');
        if (preferences.availability.length) {
          const normalize = (
            values: { isoWeekday: number; availableMinutes: number }[],
          ) =>
            JSON.stringify(
              [...values].sort((a, b) => a.isoWeekday - b.isoWeekday),
            );
          if (
            normalize(options.availability) !==
              normalize(
                preferences.availability.map((a) => ({
                  isoWeekday: a.iso_weekday,
                  availableMinutes: a.available_minutes,
                })),
              ) ||
            options.timezone !== preferences.timezone
          )
            throw new ApiError(
              409,
              '기존 계획과 같은 학습 가능 시간과 시간대를 사용해 주세요.',
            );
        }
        const reserved = await rows<ScheduleSession>(
          auth,
          'schedule_sessions',
          {
            and: `(study_date.gte.${options.startDate},study_date.lte.${addDays(options.startDate, 3660)})`,
            status: 'neq.SKIPPED',
          },
        );
        const activeIds = new Set(plans.map((p) => p.id));
        const schedule = createInitialSchedule(
          book,
          options,
          reserved.filter((s) => activeIds.has(s.plan_id)),
        );
        if (schedule.status === 'conflict')
          return json(
            {
              error:
                '선택한 분량을 배정하기 어렵습니다. 가능 시간을 늘리거나 목표일·하루 분량을 조정해 주세요.',
              schedule,
            },
            409,
          );
        if (input.preview) return json({ schedule });
        const planId: unknown = await rest(
          auth,
          'rpc/create_initial_book_plan',
          {},
          {
            p_resource_id: resourceId,
            p_expected_total: book.total_pages,
            p_expected_completed: book.initial_completed_workload,
            p_options: options,
            p_sessions: schedule.sessions,
            p_forecast: schedule.forecastDate,
          },
        );
        return json({ planId, schedule }, 201);
      } catch (error) {
        return handle(error);
      }
    },
  };
}
