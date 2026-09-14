import type { PlanMode } from '@paceon/shared';

export interface Availability { readonly isoWeekday: number; readonly availableMinutes: number }
export interface Reservation { readonly studyDate: string; readonly minutes: number }
export interface BookInput {
  readonly totalPages: number;
  readonly completedThroughPage: number;
  readonly startDate: string;
  readonly timezone: string;
  readonly mode: PlanMode;
  readonly dailyPages?: number;
  readonly minutesPerPage: number;
  readonly availability: readonly Availability[];
  readonly targetDate?: string;
  readonly balancedIncreaseRatio?: number;
  readonly maxDays?: number;
  readonly reservedMinutes?: readonly Reservation[];
}
export interface ExistingSession {
  readonly id: string;
  readonly studyDate: string;
  readonly startPage: number;
  readonly endPage: number;
  readonly estimatedMinutes: number;
  readonly status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
  readonly isLocked: boolean;
}
export interface ReplanInput extends BookInput {
  readonly asOfDate: string;
  readonly existingSessions: readonly ExistingSession[];
}
export interface PlannedSession {
  readonly studyDate: string;
  readonly startPage: number;
  readonly endPage: number;
  readonly pages: number;
  readonly estimatedMinutes: number;
}
export type ConflictCode = 'INVALID_INPUT' | 'NO_AVAILABILITY' | 'TARGET_IN_PAST' | 'TIME_CAPACITY'
  | 'DEADLINE_CAPACITY' | 'HORIZON_EXCEEDED' | 'PINNED_OVERLAP' | 'PINNED_ORDER' | 'PINNED_CAPACITY' | 'PROGRESS_MISMATCH';
export interface Conflict { readonly code: ConflictCode; readonly detail: string }
export interface ChangeReason {
  readonly code: 'MODE_APPLIED' | 'REMAINING_PAGES' | 'PRESERVED_SESSIONS' | 'FORECAST_CHANGED' | 'TARGET_EXTENDED';
  readonly value: string | number | null;
  readonly previousValue?: string | null;
}
export interface ScheduleSuccess {
  readonly status: 'ok' | 'completed';
  readonly sessions: readonly PlannedSession[];
  readonly preservedSessions: readonly ExistingSession[];
  readonly replacedSessionIds: readonly string[];
  readonly forecastDate: string | null;
  readonly reasons: readonly ChangeReason[];
}
export interface ScheduleConflict {
  readonly status: 'conflict';
  readonly preservedSessions: readonly ExistingSession[];
  readonly conflicts: readonly Conflict[];
}
export type ScheduleResult = ScheduleSuccess | ScheduleConflict;
export interface BatchInput {
  readonly availability: readonly Availability[];
  readonly timezone: string;
  readonly reservedMinutes?: readonly Reservation[];
  readonly books: readonly { readonly id: string; readonly input: Omit<BookInput, 'availability' | 'timezone' | 'reservedMinutes'> }[];
}
export type BatchResult = { readonly status: 'ok'; readonly plans: readonly { readonly id: string; readonly result: ScheduleSuccess }[] }
  | { readonly status: 'conflict'; readonly bookId: string; readonly conflicts: readonly Conflict[] };
