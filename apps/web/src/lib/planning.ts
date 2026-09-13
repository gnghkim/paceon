import { z } from 'zod';
import { addDays, scheduleBook } from '@paceon/scheduler';
import type { Resource, Plan } from '@paceon/shared';

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
