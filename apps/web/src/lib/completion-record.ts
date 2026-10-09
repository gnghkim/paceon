/**
 * 완료 기록. 책을 다 읽었거나 교재·강의를 모두 마쳤을 때, 그동안 쌓인 기록으로
 * 언제 시작해 언제 끝냈는지, 실제로 며칠 읽었는지, 하루에 얼마나 했는지를 계산한다.
 *
 * 따로 저장하지 않는다. 기록이 곧 사실이라 기록을 고치면 카드도 따라 바뀐다.
 * 무효 처리한 기록과 복습(다시 공부한 것)은 세지 않는다. 처음 해낸 분량만 센다.
 */

import type { Plan, ProgressEvent, Resource } from '@paceon/shared';

type CompletionResource = Pick<
  Resource,
  'id' | 'status' | 'workload_unit' | 'total_pages' | 'total_units' | 'initial_completed_workload' | 'unit_label'
>;
type CompletionEvent = Pick<
  ProgressEvent,
  'id' | 'resource_id' | 'unit_id' | 'event_type' | 'voids_event_id' | 'study_date' | 'completed_workload' | 'duration_minutes'
>;
type CompletionPlan = Pick<Plan, 'resource_id' | 'status' | 'target_date' | 'created_at'>;

export interface CompletionRecord {
  /** 쪽, 챕터, 강 같은 분량의 단위. */
  unitLabel: string;
  /** 쪽으로 읽는 책이면 true. 카드 제목이 "완독 기록"이 된다. */
  book: boolean;
  startedOn: string;
  finishedOn: string;
  /** 시작일과 완료일을 모두 넣은 날 수. */
  spanDays: number;
  /** 기록이 있는 날 수. 하루에 여러 번 남겨도 하루다. */
  studyDays: number;
  /** 기록으로 해낸 분량. 등록할 때 이미 해 둔 것은 빠진다. */
  amount: number;
  /** amount ÷ studyDays, 소수 첫째 자리까지. */
  dailyAverage: number;
  /** 기록에 적은 분의 합. */
  minutes: number;
  /** 시간을 비워 둔 기록 수. 0분이라고 적은 것은 비운 것이 아니다. */
  untimedRecords: number;
  /** 등록할 때 이미 해 둔 분량. */
  initial: number;
  /** 목표일이 있던 계획이면 목표일. */
  targetDate: string | null;
  /** 목표일보다 며칠 일찍 끝냈는지. 늦으면 음수, 목표가 없으면 null. */
  daysEarly: number | null;
}

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/** 다 마친 자료의 완료 기록. 아직 끝나지 않았거나 기록이 하나도 없으면 null이다. */
export function completionRecord(
  resource: CompletionResource,
  events: readonly CompletionEvent[],
  plans: readonly CompletionPlan[],
): CompletionRecord | null {
  if (resource.status !== 'COMPLETED') return null;
  const own = events.filter((event) => event.resource_id === resource.id);
  const voided = new Set(
    own.filter((event) => event.event_type === 'VOID' && event.voids_event_id).map((event) => event.voids_event_id),
  );
  const learning = own.filter((event) => event.event_type === 'LEARNING' && !voided.has(event.id));
  // 기록 없이 다 읽은 채로 등록한 책. 날짜를 말할 근거가 없다.
  if (learning.length === 0) return null;
  const book = resource.workload_unit !== 'UNIT';
  const dates = learning.map((event) => event.study_date).sort();
  const startedOn = dates[0]!;
  const finishedOn = dates.at(-1)!;
  const studyDays = new Set(dates).size;
  // 챕터형 자료의 분량은 마친 챕터 수다. 챕터마다 적힌 작업량은 단위가 제각각이다.
  const amount = book
    ? learning.reduce((sum, event) => sum + Number(event.completed_workload), 0)
    : new Set(learning.map((event) => event.unit_id ?? event.id)).size;
  const plan = plans
    .filter((item) => item.resource_id === resource.id && item.status === 'COMPLETED')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const targetDate = plan?.target_date ?? null;
  return {
    unitLabel: book ? '쪽' : (resource.unit_label ?? '챕터'),
    book,
    startedOn,
    finishedOn,
    spanDays: dayNumber(finishedOn) - dayNumber(startedOn) + 1,
    studyDays,
    amount,
    dailyAverage: Math.round((amount / studyDays) * 10) / 10,
    minutes: learning.reduce((sum, event) => sum + (event.duration_minutes ?? 0), 0),
    untimedRecords: learning.filter((event) => event.duration_minutes === null).length,
    initial: Number(resource.initial_completed_workload),
    targetDate,
    daysEarly: targetDate ? dayNumber(targetDate) - dayNumber(finishedOn) : null,
  };
}

/** 90 → "1시간 30분", 45 → "45분", 120 → "2시간". */
export function formatStudyMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

/** 목표일과 견준 한 줄. 목표가 없으면 null이다. */
export function describeTarget(record: Pick<CompletionRecord, 'daysEarly'>): string | null {
  if (record.daysEarly === null) return null;
  if (record.daysEarly === 0) return '목표일에 맞춰 끝냈어요';
  return record.daysEarly > 0 ? `목표보다 ${record.daysEarly}일 일찍` : `목표보다 ${-record.daysEarly}일 늦게`;
}

/**
 * 이번 저장으로 처음 끝났는지. 이미 끝난 책의 마지막 기록을 고친 것은 아니다.
 * 완료 순간에만 카드를 띄우는 데 쓴다.
 */
export function justCompleted(before: number, after: number, total: number | null): boolean {
  return total !== null && total > 0 && before < total && after >= total;
}
