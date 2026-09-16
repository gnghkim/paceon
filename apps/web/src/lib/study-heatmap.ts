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

export type HeatmapWeek = { cells: (HeatmapDay | null)[]; label: string };

/**
 * 월요일 시작 주 단위로 나눈다. 첫 날짜의 요일 앞은 null로 채운다.
 * 달 이름은 그 달 1일이 들어 있는 주에만 붙여 한 달이 두 주에 걸쳐도 한 번만 나온다.
 * 첫 주에 1일이 없으면, 다음 주가 곧바로 새 달을 시작하지 않을 때만 첫 날짜의 달을 붙인다.
 */
export function heatmapWeeks(days: readonly HeatmapDay[]): HeatmapWeek[] {
  if (!days.length) return [];
  // 0=월..6=일. 날짜 문자열을 UTC 자정으로 해석해 요일만 뽑는다(시간대 변환 없음).
  const leading = (new Date(`${days[0]!.date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (HeatmapDay | null)[] = [...Array.from({ length: leading }, () => null), ...days];
  const weeks: HeatmapWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push({ cells: cells.slice(i, i + 7), label: '' });
  const month = (date: string) => `${Number(date.slice(5, 7))}월`;
  const firstOfMonth = (week: HeatmapWeek) => week.cells.find((cell): cell is HeatmapDay => cell !== null && cell.date.endsWith('-01'));
  for (const week of weeks) {
    const first = firstOfMonth(week);
    if (first) week.label = month(first.date);
  }
  const opening = weeks[0]!;
  if (!opening.label && !(weeks[1] && firstOfMonth(weeks[1]))) opening.label = month(days[0]!.date);
  return weeks;
}

/**
 * 도서 기록과 영어학습 시간을 함께 본 "학습한 날" 수.
 * statistics의 summary.activeDays는 도서 기록만 세므로 영어학습만 한 날을 놓친다.
 */
export const countActiveDays = (days: readonly HeatmapDay[]) =>
  days.filter(day => day.level > 0).length;

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

export type WeekDay = {
  date: string;
  /** 1=월 … 7=일. 화면의 요일 칸 순서와 같다. */
  isoWeekday: number;
  studied: boolean;
  isToday: boolean;
  isFuture: boolean;
};

/**
 * 오늘이 속한 주를 월요일부터 일곱 칸으로 만든다.
 * 잔디와 같은 기준으로 "학습한 날"을 표시하므로 도서와 영어학습을 함께 센다.
 * 아직 오지 않은 날은 빈칸도 실패도 아니며, 지난 날과 구분해서 보여 준다.
 */
export function currentWeek(days: readonly HeatmapDay[], today: string): WeekDay[] {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(today, -weekday);
  const byDate = new Map(days.map(day => [day.date, day]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    return {
      date,
      isoWeekday: index + 1,
      studied: (byDate.get(date)?.level ?? 0) > 0,
      isToday: date === today,
      isFuture: date > today,
    };
  });
}

/** 이번 주에 학습한 날 수. 아직 오지 않은 날은 세지 않는다. */
export const countWeekDays = (week: readonly WeekDay[]) =>
  week.filter(day => day.studied).length;
