import { dayNumber } from './dates.ts';

export interface ReadingSample {
  readonly id: string;
  readonly studyDate: string;
  readonly kind: 'LEARNING' | 'REVIEW';
  readonly pages: number;
  readonly minutes: number | null;
}
export interface SpeedInput {
  readonly asOfDate: string;
  readonly fallbackMinutesPerPage: number;
  readonly samples: readonly ReadingSample[];
  readonly windowDays?: number;
  readonly minimumSamples?: number;
}
export function estimateReadingSpeed(input: SpeedInput) {
  const today = dayNumber(input.asOfDate);
  const window = input.windowDays ?? 30;
  const minimum = input.minimumSamples ?? 3;
  if (!Number.isFinite(input.fallbackMinutesPerPage) || input.fallbackMinutesPerPage <= 0
    || !Number.isInteger(window) || window < 1 || !Number.isInteger(minimum) || minimum < 1) throw new RangeError('Invalid speed policy');
  const ids = new Set<string>();
  let totalPages = 0;
  let totalMinutes = 0;
  let sampleCount = 0;
  for (const sample of input.samples) {
    const date = dayNumber(sample.studyDate);
    if (!sample.id || ids.has(sample.id) || !['LEARNING', 'REVIEW'].includes(sample.kind)
      || !Number.isSafeInteger(sample.pages) || sample.pages <= 0
      || (sample.minutes !== null && (!Number.isFinite(sample.minutes) || sample.minutes < 0))) throw new RangeError('Invalid or duplicate reading sample');
    ids.add(sample.id);
    if (sample.kind !== 'LEARNING' || !sample.minutes || date > today || date <= today - window) continue;
    totalPages += sample.pages;
    totalMinutes += sample.minutes;
    sampleCount++;
  }
  if (!Number.isSafeInteger(totalPages) || !Number.isFinite(totalMinutes)) throw new RangeError('Sample totals exceed numeric range');
  const observed = sampleCount >= minimum;
  const minutesPerPage = observed ? totalMinutes / totalPages : input.fallbackMinutesPerPage;
  if (!Number.isFinite(minutesPerPage) || minutesPerPage <= 0) throw new RangeError('Speed is outside the numeric range');
  return { source: observed ? 'observed' as const : 'fallback' as const,
    minutesPerPage,
    sampleCount, totalPages, totalMinutes };
}
