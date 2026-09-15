import { addDays } from '@paceon/scheduler';
import type { ProgressEvent, Resource } from '@paceon/shared';
import { projectProgress, ProgressError } from './progress.ts';

export interface StatisticsMetrics {
  learningPages: number;
  reviewPages: number;
  recordedMinutes: number;
  events: number;
  timedEvents: number;
  untimedEvents: number;
  activeDays: number;
  minutesPerPage: number | null;
}
export interface DailyMetrics extends StatisticsMetrics {
  date: string;
  learningMinutes: number;
}
export interface SummaryMetrics extends StatisticsMetrics {
  learningMinutes: number;
}
export interface StatisticsData {
  from: string;
  to: string;
  today: string;
  timezone: string;
  summary: SummaryMetrics;
  days: DailyMetrics[];
  resources: (StatisticsMetrics & { id: string; title: string; source: string })[];
}

export function statisticsRange(from: string | undefined, to: string | undefined, today: string) {
  const end = to ?? today;
  const start = from ?? addDays(end, -29);
  if (addDays(start, 0) !== start || addDays(end, 0) !== end || start > end || end > today || end > addDays(start, 365))
    throw new RangeError('오늘까지의 날짜를 최대 366일 범위로 선택해 주세요.');
  return { from: start, to: end };
}

function metrics(events: readonly ProgressEvent[]): StatisticsMetrics {
  const result: StatisticsMetrics = { learningPages: 0, reviewPages: 0, recordedMinutes: 0, events: events.length, timedEvents: 0, untimedEvents: 0, activeDays: new Set(events.map(event => event.study_date)).size, minutesPerPage: null };
  let speedMinutes = 0;
  let speedPages = 0;
  for (const event of events) {
    if (event.event_type === 'LEARNING') result.learningPages += event.completed_workload;
    else result.reviewPages += event.completed_workload;
    if (event.duration_minutes === null) result.untimedEvents++;
    else {
      result.timedEvents++;
      result.recordedMinutes += event.duration_minutes;
      if (event.event_type === 'LEARNING' && event.duration_minutes > 0 && event.completed_workload > 0) {
        speedMinutes += event.duration_minutes;
        speedPages += event.completed_workload;
      }
    }
  }
  result.minutesPerPage = speedPages ? speedMinutes / speedPages : null;
  return result;
}

export function buildStatistics(input: {
  resources: readonly Resource[];
  events: readonly ProgressEvent[];
  from: string;
  to: string;
  today: string;
  timezone: string;
  learningMinutesByDay?: Readonly<Record<string, number>>;
}): StatisticsData {
  const { from, to } = statisticsRange(input.from, input.to, input.today);
  const learningMinutesByDay = input.learningMinutesByDay ?? {};
  const histories = new Map<string, ProgressEvent[]>();
  for (const event of input.events) {
    const history = histories.get(event.resource_id) ?? [];
    history.push(event);
    histories.set(event.resource_id, history);
  }
  const selected: ProgressEvent[] = [];
  const resources: StatisticsData['resources'] = [];
  for (const resource of input.resources) {
    if (resource.type !== 'BOOK' || resource.workload_unit !== 'PAGE') continue;
    // Resolve VOID against the complete history before applying the date window.
    const events = projectProgress(resource, histories.get(resource.id) ?? []).activeEvents.filter(event =>
      (event.event_type === 'LEARNING' || event.event_type === 'REVIEW') && event.study_date >= from && event.study_date <= to);
    for (const event of events) {
      if (event.event_type === 'REVIEW' && (!Number.isSafeInteger(event.start_page) || !Number.isSafeInteger(event.end_page)
        || event.start_page! < 1 || event.end_page! < event.start_page! || event.end_page! > resource.total_pages!
        || event.completed_workload !== event.end_page! - event.start_page! + 1))
        throw new ProgressError('복습 기록의 페이지 범위가 올바르지 않습니다.', 'CORRUPT_PROGRESS');
    }
    selected.push(...events);
    if (events.length) resources.push({ id: resource.id, title: resource.title, source: resource.source, ...metrics(events) });
  }
  const dates = new Map<string, ProgressEvent[]>();
  for (const event of selected) {
    const day = dates.get(event.study_date) ?? [];
    day.push(event);
    dates.set(event.study_date, day);
  }
  const days: DailyMetrics[] = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    days.push({ date, learningMinutes: learningMinutesByDay[date] ?? 0, ...metrics(dates.get(date) ?? []) });
  resources.sort((a, b) => b.learningPages - a.learningPages || a.id.localeCompare(b.id));
  const summary: SummaryMetrics = { learningMinutes: days.reduce((sum, day) => sum + day.learningMinutes, 0), ...metrics(selected) };
  return { from, to, today: input.today, timezone: input.timezone, summary, days, resources };
}
