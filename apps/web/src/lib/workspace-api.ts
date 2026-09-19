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
import { completedUnits, unitProgress } from './unit-progress.ts';

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
    init: { method?: string; headers?: Record<string, string> } = {},
  ) {
    const url = new URL(`/rest/v1/${table}`, auth.base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetcher(url, {
      headers: {
        ...auth.headers,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      // A DELETE carries no body, so the method must not depend on one.
      ...(body === undefined
        ? init.method
          ? { method: init.method }
          : {}
        : { method: init.method ?? 'POST', body: JSON.stringify(body) }),
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
    // A minimal-return write answers with an empty body, as 200 or 204.
    const text = await response.text();
    return text ? JSON.parse(text) : null;
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
      // Postgres time comes back as HH:MM:SS; the form and the input want HH:MM.
      notifyAt: profiles[0]?.notify_at ? profiles[0].notify_at.slice(0, 5) : null,
    };
  }
  /** Writes only the named settings so a stale client cannot overwrite the shared timezone. */
  async function saveProfile(auth: Auth, patch: Record<string, unknown>) {
    await rest(
      auth,
      'learner_profiles',
      { on_conflict: 'user_id' },
      { user_id: auth.userId, ...patch },
      { headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } },
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
    saveProfile,
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
        const [resources, materials, plans, sessions, events, replans] = await Promise.all([
          rows<Resource>(auth, 'resources', {
            type: 'eq.BOOK',
            ...(id ? { id: `eq.${id}` } : {}),
          }),
          rows<Resource>(auth, 'resources', {
            workload_unit: 'eq.UNIT',
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
        // 서버 필터만 믿지 않는다. 두 목록이 섞이면 책 화면이 챕터형 자료를 책처럼 그린다.
        const pageBooks = resources.filter((item) => item.workload_unit !== 'UNIT');
        const unitMaterials = materials.filter((item) => item.workload_unit === 'UNIT');
        if (id && !pageBooks.length && !unitMaterials.length)
          throw new ApiError(404, '자료를 찾을 수 없습니다.');
        // 일정 카드가 챕터 제목을 보여 줄 수 있게, 조회 기간의 일정이 가리키는 챕터만 읽는다.
        const unitIds = [...new Set(sessions.map((s) => s.unit_id).filter((value): value is string => !!value))];
        const unitRows: { id: string; title: string; estimated_minutes: number | null; sequence: number }[] = [];
        for (let index = 0; index < unitIds.length; index += 100)
          unitRows.push(
            ...(await rows<{ id: string; title: string; estimated_minutes: number | null; sequence: number }>(auth, 'resource_units', {
              select: 'id,title,estimated_minutes,sequence',
              id: `in.(${unitIds.slice(index, index + 100).join(',')})`,
            })),
          );
        const active = new Set(
          plans.filter((p) => p.status === 'ACTIVE').map((p) => p.id),
        );
        const sequenceOf = new Map(unitRows.map((unit) => [unit.id, unit.sequence]));
        const data: WorkspaceData = {
          resources: pageBooks,
          materials: unitMaterials,
          units: Object.fromEntries(unitRows.map((unit) => [unit.id, { title: unit.title, minutes: unit.estimated_minutes }])),
          materialProgress: Object.fromEntries(
            unitMaterials.map((item) => {
              const done = completedUnits(events.filter((event) => event.resource_id === item.id));
              return [item.id, unitProgress(item.total_units ?? 0, done.size)];
            }),
          ),
          plans: plans.sort((a, b) => b.created_at.localeCompare(a.created_at)),
          progress: Object.fromEntries(pageBooks.map(book => {
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
                // 같은 날의 챕터는 챕터 순서대로. 일정의 id는 무작위라 순서를 말해 주지 않는다.
                a.resource_id.localeCompare(b.resource_id) ||
                (sequenceOf.get(a.unit_id ?? '') ?? 0) - (sequenceOf.get(b.unit_id ?? '') ?? 0) ||
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
            dailyLearningMinutes: z.number().int().min(1).max(1440).nullable().optional(),
            // 24시간제 HH:MM. null이면 알림을 끈다.
            notifyAt: z
              .string()
              .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
              .nullable()
              .optional(),
          })
          .strict()
          .refine(
            value => value.dailyLearningMinutes !== undefined || value.notifyAt !== undefined,
            '바꿀 설정을 알려 주세요.',
          )
          .parse(await readBody(request));
        const patch: Record<string, unknown> = {};
        if (input.dailyLearningMinutes !== undefined)
          patch.daily_learning_minutes = input.dailyLearningMinutes;
        if (input.notifyAt !== undefined) {
          patch.notify_at = input.notifyAt;
          // 시각을 바꾸면 오늘 이미 보냈다는 표시를 지운다. 새 시각으로 오늘부터 받는다.
          patch.notify_last_sent_on = null;
        }
        await saveProfile(auth, patch);
        return json(input);
      } catch (error) {
        if (error instanceof z.ZodError)
          return json(
            { error: '목표 시간은 1분에서 1440분 사이로, 알림 시각은 HH:MM으로 정해 주세요.' },
            400,
          );
        return handle(error);
      }
    },
    /**
     * 계획을 잠시 멈추거나 다시 시작한다.
     * 멈춘 계획의 일정은 오늘·캘린더·간편 기록에서 빠지고 기록은 그대로 남는다.
     * 멈춘 동안에도 그 계획이 잡아 둔 시간은 다른 책에 넘어가지 않는다.
     *
     * plans의 모든 UPDATE는 트리거가 버전을 올린다. 상태만 바꿔도 마찬가지이므로
     * 호출자가 이어서 재계획하려면 여기서 돌려주는 새 버전을 써야 한다.
     */
    async PLAN_STATUS(request: Request, resourceId: string) {
      try {
        const auth = await authenticate(request);
        uuid.parse(resourceId);
        const input = z
          .object({ status: z.enum(['ACTIVE', 'PAUSED']) })
          .strict()
          .parse(await readBody(request));
        const [book] = await rows<Resource>(auth, 'resources', {
          id: `eq.${resourceId}`,
          type: 'eq.BOOK',
        });
        if (!book) throw new ApiError(404, '자료를 찾을 수 없습니다.');
        if (input.status === 'ACTIVE' && book.status === 'ARCHIVED')
          throw new ApiError(
            409,
            '보관한 책이에요. 보관을 해제한 뒤 계획을 다시 시작해 주세요.',
          );
        const updated = await rest(
          auth,
          'plans',
          {
            resource_id: `eq.${resourceId}`,
            user_id: `eq.${auth.userId}`,
            status: `in.(ACTIVE,PAUSED)`,
            select: 'id,status,version',
          },
          { status: input.status },
          { method: 'PATCH', headers: { Prefer: 'return=representation' } },
        );
        if (!Array.isArray(updated) || !updated.length)
          throw new ApiError(
            404,
            '멈추거나 다시 시작할 계획이 없어요. 먼저 계획을 만들어 주세요.',
          );
        const changed = (updated as { id: string; version: number }[])[0]!;
        return json({
          status: input.status,
          planId: changed.id,
          planVersion: changed.version,
        });
      } catch (error) {
        if (error instanceof z.ZodError)
          return json({ error: '계획 상태를 확인해 주세요.' }, 400);
        return handle(error);
      }
    },
    /**
     * 책을 보관하거나 되돌린다.
     * 보관하면 계획도 함께 멈춰 일정이 오늘과 캘린더에서 사라진다.
     * 보관을 풀어도 계획은 멈춘 채로 두고, 다시 시작할지는 사용자가 정한다.
     */
    async BOOK_STATUS(request: Request, resourceId: string) {
      try {
        const auth = await authenticate(request);
        uuid.parse(resourceId);
        const input = z
          .object({ status: z.enum(['ACTIVE', 'ARCHIVED']) })
          .strict()
          .parse(await readBody(request));
        const [book] = await rows<Resource>(auth, 'resources', {
          id: `eq.${resourceId}`,
          type: 'eq.BOOK',
        });
        if (!book) throw new ApiError(404, '자료를 찾을 수 없습니다.');
        if (book.status === 'COMPLETED' && input.status === 'ACTIVE')
          throw new ApiError(409, '완독한 책의 상태는 바꿀 수 없어요.');
        if (input.status === 'ARCHIVED')
          await rest(
            auth,
            'plans',
            {
              resource_id: `eq.${resourceId}`,
              user_id: `eq.${auth.userId}`,
              status: 'eq.ACTIVE',
            },
            { status: 'PAUSED' },
            { method: 'PATCH', headers: { Prefer: 'return=minimal' } },
          );
        await rest(
          auth,
          'resources',
          { id: `eq.${resourceId}`, user_id: `eq.${auth.userId}` },
          { status: input.status },
          { method: 'PATCH', headers: { Prefer: 'return=minimal' } },
        );
        return json({ status: input.status });
      } catch (error) {
        if (error instanceof z.ZodError)
          return json({ error: '보관 상태를 확인해 주세요.' }, 400);
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
