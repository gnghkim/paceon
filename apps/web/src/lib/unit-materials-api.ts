import { z } from 'zod';
import type { Plan, ProgressEvent, Resource, ScheduleSession, Tables } from '@paceon/shared';
import { ApiError, json, readBody } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { completedUnits, unitProgress, unitStudies, type UnitStudy } from './unit-progress.ts';
import { MAX_UNITS } from './unit-outline.ts';

type UnitRow = Tables<'resource_units'>;
const uuid = z.uuid();

const outlineItem = z
  .object({
    title: z.string().trim().min(1).max(500),
    minutes: z.number().int().min(1).max(1440).optional(),
    section: z.literal(true).optional(),
  })
  .strict();

const create = z
  .object({
    title: z.string().trim().min(1).max(500),
    kind: z.enum(['COURSE', 'TEXTBOOK']),
    unitLabel: z.string().trim().min(1).max(20),
    author: z.string().trim().max(500).optional(),
    sourceUrl: z.url().max(2000).optional(),
    units: z.array(outlineItem).min(1).max(MAX_UNITS + 500),
  })
  .strict()
  .refine((value) => value.units.some((unit) => !unit.section), '챕터가 하나 이상 있어야 해요.')
  .refine((value) => value.units.filter((unit) => !unit.section).length <= MAX_UNITS);

const planOptions = z
  .object({
    dailyUnits: z.number().int().min(1).max(100),
    minutesPerUnit: z.number().int().min(1).max(1440),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

const progress = z
  .object({
    kind: z.enum(['COMPLETE', 'REPEAT', 'UNDO']),
    unitId: z.uuid(),
    idempotencyKey: z.uuid(),
    studyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    durationMinutes: z.number().int().min(0).max(1440).nullable().optional(),
    memo: z.string().max(10000).optional(),
  })
  .strict()
  .refine((value) => value.kind !== 'UNDO' || (value.durationMinutes == null && !value.memo));

export interface MaterialUnit {
  id: string;
  title: string;
  sequence: number;
  section: boolean;
  parentId: string | null;
  minutes: number | null;
  done: boolean;
  /** 남은 일정에서 이 챕터가 잡힌 날. 완료했거나 아직 담기지 않았으면 null이다. */
  scheduledOn: string | null;
  studies: UnitStudy[];
}

export interface MaterialDetail {
  material: Pick<Resource, 'id' | 'title' | 'type' | 'author' | 'status' | 'unit_label' | 'total_units' | 'progress_version' | 'replan_required' | 'source_id'>;
  plan: Pick<Plan, 'id' | 'status' | 'start_date' | 'forecast_date' | 'preferred_daily_workload' | 'minutes_per_page' | 'timezone'> | null;
  progress: { done: number; total: number; percent: number };
  units: MaterialUnit[];
  today: string;
}

const conflictText: Record<string, string> = {
  NO_AVAILABILITY: '학습할 수 있는 시간이 없어요. 설정에서 요일별 학습 시간을 먼저 정해 주세요.',
  TIME_CAPACITY: '다른 일정으로 시간이 가득 차 있어요. 하루 학습 시간을 늘리거나 다른 계획을 줄여 주세요.',
};

/**
 * 챕터로 공부하는 자료(교재, 강의). 일정은 DB 함수가 계산하므로 여기서는 입력을
 * 확인해 넘기고, 돌아온 오류를 읽을 수 있는 말로 바꾼다.
 */
export function createUnitMaterialHandlers(
  config: Config | undefined,
  fetcher: typeof fetch = globalThis.fetch,
) {
  const storage = createWorkspaceHandlers(config, fetcher);
  type Auth = Awaited<ReturnType<typeof storage.authenticate>>;

  /** DB 함수를 부른다. 공용 rest()는 오류의 이유를 버리므로 여기서는 직접 읽는다. */
  async function rpc<T>(auth: Auth, name: string, body: unknown): Promise<T> {
    const response = await fetcher(new URL(`/rest/v1/rpc/${name}`, auth.base), {
      method: 'POST',
      headers: { ...auth.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401 || response.status === 403)
      throw new ApiError(401, '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    const text = await response.text();
    if (response.ok) return (text ? JSON.parse(text) : null) as T;
    let problem: { code?: string; message?: string } = {};
    try {
      problem = JSON.parse(text) as typeof problem;
    } catch {
      /* 읽을 수 없는 오류는 아래에서 일시적인 문제로 다룬다. */
    }
    const conflict = /^UNIT_PLAN_CONFLICT:(\w+)/.exec(problem.message ?? '');
    if (conflict)
      throw new ApiError(409, conflictText[conflict[1]!] ?? '일정을 담지 못했어요. 학습 시간을 확인해 주세요.');
    if (problem.code === '23505') throw new ApiError(409, '이미 완료한 챕터예요.');
    if (problem.code === '23514') {
      if (/not completed/i.test(problem.message ?? ''))
        throw new ApiError(409, '아직 공부하지 않은 챕터예요.');
      if (/archived/i.test(problem.message ?? ''))
        throw new ApiError(409, '보관한 자료예요. 보관을 해제한 뒤 이어 가세요.');
      throw new ApiError(400, '입력한 내용을 확인해 주세요.');
    }
    if (problem.code === '42501') throw new ApiError(404, '자료나 챕터를 찾을 수 없어요.');
    if (problem.code === 'P0002') throw new ApiError(404, '먼저 계획을 만들어 주세요.');
    if (problem.code === '40001') throw new ApiError(409, '같은 요청이 다른 내용으로 다시 왔어요. 새로고침해 주세요.');
    throw new ApiError(503, '잠시 연결하지 못했습니다. 다시 시도해 주세요.');
  }

  async function material(auth: Auth, id: string) {
    const [row] = await storage.rows<Resource>(auth, 'resources', { id: `eq.${id}`, workload_unit: 'eq.UNIT' });
    if (!row) throw new ApiError(404, '자료를 찾을 수 없어요.');
    return row;
  }

  return {
    /** 자료와 챕터를 한 번에 만든다. 계획은 따로 만든다. 책의 등록과 같은 두 단계다. */
    async CREATE(request: Request) {
      try {
        const auth = await storage.authenticate(request);
        const input = create.parse(await readBody(request));
        const id = await rpc<string>(auth, 'create_unit_material', { p_input: input });
        return json({ id }, 201);
      } catch (error) {
        return fail(error, '제목과 챕터 목록을 확인해 주세요.');
      }
    },

    async DETAIL(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        uuid.parse(resourceId);
        const row = await material(auth, resourceId);
        const [units, plans, sessions, events, preferences] = await Promise.all([
          storage.rows<UnitRow>(auth, 'resource_units', { resource_id: `eq.${resourceId}`, order: 'sequence.asc' }),
          storage.rows<Plan>(auth, 'plans', { resource_id: `eq.${resourceId}`, status: 'in.(ACTIVE,PAUSED,COMPLETED)' }),
          storage.rows<ScheduleSession>(auth, 'schedule_sessions', { resource_id: `eq.${resourceId}` }),
          storage.rows<ProgressEvent>(auth, 'progress_events', { resource_id: `eq.${resourceId}` }),
          storage.settings(auth),
        ]);
        const plan = [...plans].sort(
          (a, b) => rank(a.status) - rank(b.status) || b.created_at.localeCompare(a.created_at),
        )[0];
        const today = todayIn(plan?.timezone ?? preferences.timezone);
        const done = completedUnits(events);
        // 남은 일정에서 그 챕터가 잡힌 가장 이른 날.
        const scheduled = new Map<string, string>();
        for (const session of sessions) {
          if (!session.unit_id || session.study_date < today || session.plan_id !== plan?.id) continue;
          const current = scheduled.get(session.unit_id);
          if (!current || session.study_date < current) scheduled.set(session.unit_id, session.study_date);
        }
        const leaves = units.filter((unit) => unit.unit_type !== 'SECTION');
        const detail: MaterialDetail = {
          material: {
            id: row.id,
            title: row.title,
            type: row.type,
            author: row.author,
            status: row.status,
            unit_label: row.unit_label,
            total_units: row.total_units,
            progress_version: row.progress_version,
            replan_required: row.replan_required,
            source_id: row.source_id,
          },
          plan: plan
            ? {
                id: plan.id,
                status: plan.status,
                start_date: plan.start_date,
                forecast_date: plan.forecast_date,
                preferred_daily_workload: plan.preferred_daily_workload,
                minutes_per_page: plan.minutes_per_page,
                timezone: plan.timezone,
              }
            : null,
          progress: unitProgress(leaves.length, leaves.filter((unit) => done.has(unit.id)).length),
          units: units.map((unit) => ({
            id: unit.id,
            title: unit.title,
            sequence: unit.sequence,
            section: unit.unit_type === 'SECTION',
            parentId: unit.parent_unit_id,
            minutes: unit.estimated_minutes,
            done: done.has(unit.id),
            scheduledOn: done.has(unit.id) ? null : (scheduled.get(unit.id) ?? null),
            studies: unit.unit_type === 'SECTION' ? [] : unitStudies(events, unit.id),
          })),
          today,
        };
        return json(detail);
      } catch (error) {
        return fail(error, '자료를 확인해 주세요.');
      }
    },

    /** 계획을 만들거나 하루 분량을 바꾼다. 어느 쪽이든 남은 챕터를 다시 담는다. */
    async PLAN(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        uuid.parse(resourceId);
        const input = planOptions.parse(await readBody(request));
        const { timezone } = await storage.settings(auth);
        const result = await rpc<Record<string, unknown>>(auth, 'plan_unit_material', {
          p_resource_id: resourceId,
          p_options: { ...input, timezone },
        });
        return json(result);
      } catch (error) {
        return fail(error, '하루 분량과 챕터당 시간을 확인해 주세요.');
      }
    },

    /** 챕터 하나를 공부했다, 다시 공부했다, 또는 완료를 취소한다. */
    async PROGRESS(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        uuid.parse(resourceId);
        const input = progress.parse(await readBody(request));
        const { memo, durationMinutes, ...rest } = input;
        const result = await rpc<Record<string, unknown>>(auth, 'submit_unit_progress', {
          p_resource_id: resourceId,
          p_request: {
            ...rest,
            ...(durationMinutes == null ? {} : { durationMinutes }),
            ...(memo?.trim() ? { memo: memo.trim() } : {}),
          },
        });
        return json(result);
      } catch (error) {
        return fail(error, '기록할 내용을 확인해 주세요.');
      }
    },

    /** 지난 일정을 지나쳤을 때 남은 챕터를 내일부터 다시 담는다. */
    async REPLAN(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        uuid.parse(resourceId);
        return json(await rpc<Record<string, unknown>>(auth, 'replan_unit_plan', { p_resource_id: resourceId, p_dry_run: false }));
      } catch (error) {
        return fail(error, '자료를 확인해 주세요.');
      }
    },

    /** 계획을 멈추거나 다시 시작한다. 다시 시작하면 남은 챕터를 내일부터 다시 담는다. */
    async STATUS(request: Request, resourceId: string) {
      try {
        const auth = await storage.authenticate(request);
        uuid.parse(resourceId);
        const input = z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }).strict().parse(await readBody(request));
        await material(auth, resourceId);
        const updated = await storage.rest(
          auth,
          'plans',
          { resource_id: `eq.${resourceId}`, user_id: `eq.${auth.userId}`, status: 'in.(ACTIVE,PAUSED)', select: 'id' },
          { status: input.status },
          { method: 'PATCH', headers: { Prefer: 'return=representation' } },
        );
        if (!Array.isArray(updated) || !updated.length)
          throw new ApiError(404, '멈추거나 다시 시작할 계획이 없어요.');
        if (input.status === 'ACTIVE')
          await rpc(auth, 'replan_unit_plan', { p_resource_id: resourceId, p_dry_run: false });
        return json({ status: input.status });
      } catch (error) {
        return fail(error, '계획 상태를 확인해 주세요.');
      }
    },
  };
}

const rank = (status: Plan['status']) => (status === 'ACTIVE' ? 0 : status === 'PAUSED' ? 1 : 2);

function todayIn(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
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
