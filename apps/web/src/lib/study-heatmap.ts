import { addDays } from '@paceon/scheduler';
import type { DailyMetrics } from './statistics.ts';

export type HeatmapDay = { date: string; minutes: number; level: 0 | 1 | 2 | 3 | 4 };

/** 0 기록없음, 1 15분 미만 또는 시간 미입력만 있음, 2 15-29분, 3 30-59분, 4 60분 이상. */
export function heatmapLevel(minutes: number, untimedEvents: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return untimedEvents > 0 ? 1 : 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

export function buildHeatmap(days: readonly DailyMetrics[]): HeatmapDay[] {
  return days.map(day => {
    const minutes = day.learningMinutes + day.recordedMinutes;
    return { date: day.date, minutes, level: heatmapLevel(minutes, day.untimedEvents) };
  });
}

/** level>0인 날만 "학습한 날"로 센다(시간 미입력만 있어 level=1인 날 포함). */
export function computeStreak(days: readonly HeatmapDay[], today: string): { current: number; longest: number; asOf: string } {
  let longest = 0;
  let running = 0;
  for (const day of days) {
    running = day.level > 0 ? running + 1 : 0;
    if (running > longest) longest = running;
  }
  const byDate = new Map(days.map(day => [day.date, day]));
  const asOf = (byDate.get(today)?.level ?? 0) > 0 ? today : addDays(today, -1);
  let current = 0;
  for (let date = asOf; (byDate.get(date)?.level ?? 0) > 0; date = addDays(date, -1)) current++;
  return { current, longest, asOf };
}

/** 1년 합계 전용 "H시간 M분" 포맷. 짧은 기간용 "{분}분" 표기, 타이머용 MM:SS(learningDuration)와는 별개다. */
export function formatStudyDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
