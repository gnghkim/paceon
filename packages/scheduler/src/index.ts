import type { PlanMode } from '@paceon/shared';
export * from './types.ts';
export { scheduleBook, replanBook, scheduleBooks } from './scheduler.ts';
export { addDays, toStudyDate } from './dates.ts';
export { estimateReadingSpeed } from './speed.ts';
export type { ReadingSample, SpeedInput } from './speed.ts';

/** Versioned algorithm contract; independent from database plan revision numbers. */
export const schedulerContract = {
  implementation: 'book-scheduler-v1',
  modes: ['DEADLINE', 'PACE', 'BALANCED'] as const satisfies readonly PlanMode[],
} as const;
