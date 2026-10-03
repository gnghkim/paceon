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
