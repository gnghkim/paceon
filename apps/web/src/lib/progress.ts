import { z } from 'zod';
import { addDays, estimateReadingSpeed, replanBook } from '@paceon/scheduler';
import type { ScheduleResult } from '@paceon/scheduler';
import type { AvailabilityRule, Plan, PlanMode, ProgressEvent, Resource, ScheduleSession } from '@paceon/shared';

const date = z.string().refine(value => {
  try { return addDays(value, 0) === value; } catch { return false; }
}, '올바른 날짜를 입력해 주세요.');
const page = z.number().int().min(1).max(10_000_000);
const base = {
  idempotencyKey: z.uuid(), planId: z.uuid(),
  expectedPlanVersion: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  expectedProgressVersion: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};
const record = {
  studyDate: date,
  durationMinutes: z.number().int().min(0).max(1440).nullable().default(null),
  memo: z.string().trim().max(2000).default(''),
};
const schema = z.discriminatedUnion('kind', [
  z.object({ ...base, ...record, kind: z.literal('LEARNING'), endPage: page }).strict(),
  z.object({ ...base, ...record, kind: z.literal('REVIEW'), startPage: page, endPage: page }).strict()
    .refine(value => value.endPage >= value.startPage, '종료 페이지를 확인해 주세요.'),
  z.object({ ...base, ...record, kind: z.literal('CORRECTION'), eventId: z.uuid(), endPage: z.number().int().min(0).max(10_000_000) }).strict(),
  z.object({ ...base, kind: z.literal('REPLAN'), mode: z.enum(['PACE', 'DEADLINE', 'BALANCED']).optional(), dailyPages: page.optional(), targetDate: date.nullable().optional() }).strict(),
]);
export type ProgressRequest = z.infer<typeof schema>;
export function parseProgressRequest(value: unknown): ProgressRequest { return schema.parse(value); }

export class ProgressError extends Error {
  readonly code: string;
  constructor(message: string, code = 'INVALID_PROGRESS') {
    super(message); this.name = 'ProgressError'; this.code = code;
  }
}
type ProgressBook = Pick<Resource, 'total_pages' | 'initial_completed_workload'>;
export function projectProgress(book: ProgressBook, events: readonly ProgressEvent[]) {
  const total = book.total_pages ?? 0;
  const initial = book.initial_completed_workload;
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(initial) || initial < 0 || initial > total)
    throw new ProgressError('책의 전체 페이지와 시작 진도를 확인해 주세요.');
  const ids = new Set<string>();
  const voided = new Set<string>();
  for (const event of events) {
    if (!event.id || ids.has(event.id)) throw new ProgressError('중복된 학습 기록이 있습니다.');
    ids.add(event.id);
    if (event.event_type === 'VOID' && event.voids_event_id) voided.add(event.voids_event_id);
  }
  const activeEvents = events.filter(event => event.event_type !== 'VOID' && !voided.has(event.id));
  const learning = activeEvents.filter(event => event.event_type === 'LEARNING')
    .sort((a, b) => (a.start_page ?? 0) - (b.start_page ?? 0));
  let completedThroughPage = initial;
  for (const event of learning) {
    if (!Number.isSafeInteger(event.start_page) || !Number.isSafeInteger(event.end_page)
      || event.start_page !== completedThroughPage + 1 || event.end_page! < event.start_page!
      || event.end_page! > total || event.completed_workload !== event.end_page! - event.start_page! + 1)
      throw new ProgressError('학습 기록의 페이지가 겹치거나 이어지지 않습니다. 기록을 확인해 주세요.', 'CORRUPT_PROGRESS');
    completedThroughPage = event.end_page!;
  }
  return { completedThroughPage, percent: Math.round(completedThroughPage / total * 100), latestLearningId: learning.at(-1)?.id ?? null, activeEvents };
}
export interface ProgressCandidate {
  completedThroughPage: number;
  minutesPerPage: number;
  speedSource: 'observed' | 'fallback';
  schedule: ScheduleResult;
  mode: PlanMode;
  dailyPages: number | null;
  targetDate: string | null;
}
export interface ProgressCandidateInput {
  book: ProgressBook;
  plan: Pick<Plan, 'mode' | 'preferred_daily_workload' | 'target_date' | 'start_date' | 'timezone'> & { minutes_per_page: number };
  events: readonly ProgressEvent[];
  sessions: readonly ScheduleSession[];
  availability: readonly Pick<AvailabilityRule, 'iso_weekday' | 'available_minutes'>[];
  otherSessions: readonly Pick<ScheduleSession, 'study_date' | 'estimated_minutes'>[];
  request: ProgressRequest;
  asOfDate: string;
}
export function calculateProgressCandidate(input: ProgressCandidateInput): ProgressCandidate {
  const { book, plan, events, sessions, availability, otherSessions, asOfDate } = input;
  const request = parseProgressRequest(input.request);
  if (!date.safeParse(asOfDate).success) throw new ProgressError('기준 날짜를 확인해 주세요.');
  const current = projectProgress(book, events);
  let activeEvents = current.activeEvents;
  let completedThroughPage = current.completedThroughPage;
  if (request.kind !== 'REPLAN') {
    if (request.studyDate > asOfDate) throw new ProgressError('미래 날짜에는 학습을 기록할 수 없습니다.');
    let startPage = request.kind === 'REVIEW' ? request.startPage : completedThroughPage + 1;
    if (request.kind === 'CORRECTION') {
      if (request.eventId !== current.latestLearningId) throw new ProgressError('가장 최근의 유효한 읽기 기록만 수정할 수 있습니다.');
      const corrected = activeEvents.find(event => event.id === request.eventId)!;
      startPage = corrected.start_page!;
      activeEvents = activeEvents.filter(event => event.id !== request.eventId);
    }
    const minimumEnd = request.kind === 'CORRECTION' ? startPage - 1 : startPage;
    if (request.endPage < minimumEnd || request.endPage > book.total_pages!)
      throw new ProgressError('기록할 페이지 범위를 확인해 주세요.');
    if (request.kind !== 'REVIEW') completedThroughPage = request.endPage;
    if (request.endPage >= startPage) {
      const simulated: ProgressEvent = {
        id: `candidate:${request.idempotencyKey}`, event_type: request.kind === 'REVIEW' ? 'REVIEW' : 'LEARNING',
        start_page: startPage, end_page: request.endPage, completed_workload: request.endPage - startPage + 1,
        duration_minutes: request.durationMinutes, study_date: request.studyDate, memo: request.memo,
        resource_id: '', user_id: '', idempotency_key: request.idempotencyKey, timezone: plan.timezone,
        session_id: null, unit_id: null, voids_event_id: null, difficulty_feedback: null,
        started_at: null, completed_at: null, created_at: '',
      };
      activeEvents = [...activeEvents, simulated];
    }
  }
  // Invalid duration/date metadata cannot influence the speed estimate.
  const samples = activeEvents.filter(event => event.event_type === 'LEARNING'
    && date.safeParse(event.study_date).success
    && Number.isSafeInteger(event.duration_minutes) && event.duration_minutes! > 0
    && Number.isSafeInteger(event.start_page) && Number.isSafeInteger(event.end_page) && event.end_page! >= event.start_page!)
    .map(event => ({ id: event.id, kind: 'LEARNING' as const, studyDate: event.study_date,
      pages: event.end_page! - event.start_page! + 1, minutes: event.duration_minutes }));
  if (!Number.isFinite(plan.minutes_per_page) || plan.minutes_per_page <= 0)
    throw new ProgressError('계획의 기본 읽기 속도를 확인해 주세요.');
  const speed = estimateReadingSpeed({ asOfDate, fallbackMinutesPerPage: plan.minutes_per_page, samples, windowDays: 30, minimumSamples: 3 });
  const mode = request.kind === 'REPLAN' ? request.mode ?? plan.mode : plan.mode;
  const dailyPages = request.kind === 'REPLAN' ? request.dailyPages ?? plan.preferred_daily_workload : plan.preferred_daily_workload;
  const targetDate = request.kind === 'REPLAN' && request.targetDate !== undefined ? request.targetDate : plan.target_date;
  const referenced = new Set(events.map(event => event.session_id).filter(Boolean));
  let schedule = replanBook({
    totalPages: book.total_pages!, completedThroughPage, startDate: plan.start_date, asOfDate,
    timezone: plan.timezone, mode, ...(dailyPages !== null ? { dailyPages } : {}),
    ...(targetDate !== null ? { targetDate } : {}), minutesPerPage: speed.minutesPerPage,
    availability: availability.map(rule => ({ isoWeekday: rule.iso_weekday, availableMinutes: rule.available_minutes })),
    reservedMinutes: otherSessions.map(session => ({ studyDate: session.study_date, minutes: session.estimated_minutes ?? 1440 })),
    existingSessions: sessions.map(session => ({ id: session.id, studyDate: session.study_date,
      startPage: session.start_page ?? 0, endPage: session.end_page ?? 0,
      estimatedMinutes: session.estimated_minutes ?? 1440, status: session.status,
      isLocked: session.is_locked || referenced.has(session.id),
    })), maxDays: 3660,
  });
  if (schedule.status !== 'conflict') {
    const forecastDate = completedThroughPage === book.total_pages ? asOfDate : schedule.forecastDate;
    schedule = { ...schedule, forecastDate,
      reasons: schedule.reasons.map(reason => reason.code === 'FORECAST_CHANGED' ? { ...reason, value: forecastDate } : reason),
      sessions: schedule.sessions.map(session => ({ ...session,
        estimatedMinutes: Math.ceil(session.pages * speed.minutesPerPage - 1e-9),
      })),
    };
    // Two ranges around a pinned session can round up separately on the same day.
    // Validate the stored integer minutes, not only the engine's fractional total.
    const minutesByDate = new Map<string, number>();
    const reserve = (studyDate: string, minutes: number) => {
      minutesByDate.set(studyDate, (minutesByDate.get(studyDate) ?? 0) + minutes);
    };
    for (const session of otherSessions) reserve(session.study_date, session.estimated_minutes ?? 1440);
    for (const session of schedule.preservedSessions) {
      if (session.studyDate > asOfDate && session.status !== 'COMPLETED') reserve(session.studyDate, session.estimatedMinutes);
    }
    for (const session of schedule.sessions) reserve(session.studyDate, session.estimatedMinutes);
    const budgets = new Map(availability.map(rule => [rule.iso_weekday, rule.available_minutes]));
    const overBudget = schedule.sessions.find(session => {
      const weekday = new Date(`${session.studyDate}T12:00:00Z`).getUTCDay() || 7;
      return (minutesByDate.get(session.studyDate) ?? 0) > (budgets.get(weekday) ?? 0);
    });
    if (overBudget) schedule = {
      status: 'conflict', preservedSessions: schedule.preservedSessions,
      conflicts: [{ code: 'TIME_CAPACITY', detail: `${overBudget.studyDate}의 학습 시간이 하루 가용 시간을 초과합니다.` }],
    };
  }
  return { completedThroughPage, minutesPerPage: speed.minutesPerPage, speedSource: speed.source, schedule, mode, dailyPages, targetDate };
}
