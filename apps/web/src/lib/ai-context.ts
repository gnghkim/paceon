import { createHash } from 'node:crypto';
import { addDays } from '@paceon/scheduler';
import type { AiContext, AiKind } from '@paceon/ai-schema';
import type { Resource, Plan, ProgressEvent } from '@paceon/shared';
import { projectProgress } from './progress.ts';

export function buildAiContext(input: {
  book: Resource; plan: Plan | null; events: ProgressEvent[]; today: string; kind: AiKind; outline: string;
}): AiContext {
  const { book, plan, events, today, kind } = input;
  const progress = projectProgress(book, events);
  const recent = progress.activeEvents.filter(e => e.event_type === 'LEARNING' && e.study_date >= addDays(today, -6) && e.study_date <= today);
  const timed = recent.filter(e => e.duration_minutes !== null && e.duration_minutes > 0);
  const context = {
    schemaVersion: 1 as const, kind,
    book: { title: book.title.slice(0, 500), authors: book.author ? [book.author.slice(0, 200)] : [], totalPages: book.total_pages!, description: '' },
    outline: kind === 'BOOK_ANALYSIS' ? input.outline.trim().slice(0, 12000) : '',
    facts: { today, completedPages: progress.completedThroughPage, remainingPages: book.total_pages! - progress.completedThroughPage,
      progressPercent: progress.percent, planMode: plan?.mode ?? null, forecastDate: plan?.forecast_date ?? null, targetDate: plan?.target_date ?? null,
      replanRequired: book.replan_required ?? false, recentLearningPages: recent.reduce((sum, e) => sum + e.completed_workload, 0),
      recentLearningMinutes: timed.reduce((sum, e) => sum + e.duration_minutes!, 0), validTimedSamples: timed.length },
  };
  return { ...context, sourceRevision: createHash('sha256').update(JSON.stringify(context)).digest('hex') };
}
