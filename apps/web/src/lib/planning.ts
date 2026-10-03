import { z } from 'zod';
import { addDays, scheduleBook } from '@paceon/scheduler';
import type { Resource, Plan, ProgressEvent } from '@paceon/shared';

const date = z.string().refine((value) => {
  try {
    return addDays(value, 0) === value;
  } catch {
    return false;
  }
}, '올바른 날짜를 입력해 주세요.');
const schema = z
  .object({
    mode: z.enum(['PACE', 'DEADLINE', 'BALANCED']),
    startDate: date,
    targetDate: date.optional(),
    timezone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return !!value;
        } catch {
          return false;
        }
      }),
    dailyPages: z.number().int().min(1).max(10_000_000).optional(),
    minutesPerPage: z.number().min(0.1).max(1440).multipleOf(0.001),
    availability: z
      .array(
        z.object({
          isoWeekday: z.number().int().min(1).max(7),
          availableMinutes: z.number().int().min(1).max(1440),
        }),
      )
      .min(1)
      .max(7),
  })
  .refine(
    (v) =>
      new Set(v.availability.map((a) => a.isoWeekday)).size ===
      v.availability.length,
  )
  .refine((v) => v.mode !== 'DEADLINE' || !!v.targetDate)
  .refine((v) => v.mode === 'DEADLINE' || !!v.dailyPages)
  .refine((v) => !v.targetDate || v.targetDate >= v.startDate);
export type PlanOptions = z.infer<typeof schema>;
export function parsePlanOptions(value: unknown): PlanOptions {
  return schema.parse(value);
}
export function createInitialSchedule(
  book: Pick<Resource, 'total_pages' | 'initial_completed_workload'>,
  options: PlanOptions,
  reserved: readonly { study_date: string; estimated_minutes: number | null }[],
) {
  const result = scheduleBook({
    totalPages: book.total_pages ?? 0,
    completedThroughPage: book.initial_completed_workload,
    mode: options.mode,
    startDate: options.startDate,
    timezone: options.timezone,
    minutesPerPage: options.minutesPerPage,
    availability: options.availability,
    ...(options.targetDate ? { targetDate: options.targetDate } : {}),
    ...(options.dailyPages ? { dailyPages: options.dailyPages } : {}),
    maxDays: 3660,
    reservedMinutes: reserved.map((s) => ({
      studyDate: s.study_date,
      minutes: s.estimated_minutes ?? 1440,
    })),
  });
  if (result.status === 'conflict') return result;
  return {
    ...result,
    sessions: result.sessions.map((s) => ({
      ...s,
      estimatedMinutes: Math.ceil(
        (s.pages * Math.round(options.minutesPerPage * 1000)) / 1000,
      ),
    })),
  };
}
export function calendarDays(value: string): string[] {
  const first = `${value.slice(0, 7)}-01`;
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addDays(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export function summarizeBook(
  book: Pick<Resource, 'total_pages' | 'initial_completed_workload'>,
  plan: Plan | undefined,
) {
  const completed = book.initial_completed_workload;
  return {
    completed,
    percent: book.total_pages
      ? Math.min(100, Math.round((completed / book.total_pages) * 100))
      : 0,
    forecast: plan?.forecast_date ?? null,
    target: plan?.target_date ?? null,
  };
}
export function formatDate(date: string | null, detailed = false): string {
  return date
    ? new Intl.DateTimeFormat('ko-KR', {
        month: 'long',
        day: 'numeric',
        ...(detailed ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
      }).format(new Date(`${date}T12:00:00Z`))
    : '계획을 세워 주세요';
}
/**
 * 이 책을 실제로 읽은 속도(분/쪽). 시간을 적은 유효한 읽기 기록만 모아 쪽과 분을
 * 합쳐 나눈다. 계획을 다시 나눌 때 고칠 속도로 권한다. 계획이 받는 범위를 벗어나면 권하지 않는다.
 */
export function bookReadingSpeed(
  events: readonly Pick<ProgressEvent, 'id' | 'resource_id' | 'event_type' | 'start_page' | 'end_page' | 'duration_minutes' | 'voids_event_id'>[],
  bookId: string,
): number | null {
  const own = events.filter((event) => event.resource_id === bookId);
  const voided = new Set(own.map((event) => event.voids_event_id).filter(Boolean));
  let pages = 0;
  let minutes = 0;
  for (const event of own) {
    if (event.event_type !== 'LEARNING' || voided.has(event.id)) continue;
    if (!event.duration_minutes || event.duration_minutes <= 0) continue;
    if (event.start_page === null || event.end_page === null || event.end_page < event.start_page) continue;
    pages += event.end_page - event.start_page + 1;
    minutes += event.duration_minutes;
  }
  if (!pages) return null;
  const speed = Math.round((minutes / pages) * 100) / 100;
  return speed >= 0.1 && speed <= 1440 ? speed : null;
}
/**
 * 쪽당 분을 1시간에 읽는 쪽수로 바꿔 말한다. "읽는 속도"라는 이름에 큰 수를 넣으면
 * 빨라질 것 같지만 쪽당 분은 클수록 느리다. 같은 값을 두 방향으로 보여 헷갈리지 않게 한다.
 */
export function pagesPerHour(minutesPerPage: number): number | null {
  return Number.isFinite(minutesPerPage) && minutesPerPage > 0
    ? Math.floor(60 / minutesPerPage)
    : null;
}

type PreviewOutcome = {
  status: string;
  forecastAfter: string | null;
  targetDate: string | null;
  mode: string;
  minutesPerPage: number;
  conflicts: readonly { code: string }[];
};
/**
 * 목표 날짜를 못 맞춘 미리보기에 내미는 한 번에 고치는 길. 목표를 지키는 방식은
 * '목표 날짜에 맞추기'뿐이고(균형 조정은 하루 분량을 20%까지만 늘린다), 이 책을 실제로
 * 더 빨리 읽었다면 그 속도로 바꾼다. 더 느린 기록은 권하지 않는다.
 * 이미 그 설정인데도 못 맞추면 화면이 바꿀 것이 없으니 아무것도 내밀지 않는다.
 */
export function targetFix(
  preview: PreviewOutcome,
  observedSpeed: number | null,
): { mode: 'DEADLINE'; minutesPerPage: number } | null {
  if (!preview.targetDate) return null;
  const missed =
    preview.status === 'conflict'
      ? preview.conflicts.some((conflict) => conflict.code === 'DEADLINE_CAPACITY' || conflict.code === 'TIME_CAPACITY')
      : preview.forecastAfter !== null && preview.forecastAfter > preview.targetDate;
  if (!missed) return null;
  const minutesPerPage =
    observedSpeed !== null && observedSpeed < preview.minutesPerPage ? observedSpeed : preview.minutesPerPage;
  if (preview.mode === 'DEADLINE' && minutesPerPage === preview.minutesPerPage) return null;
  return { mode: 'DEADLINE', minutesPerPage };
}
