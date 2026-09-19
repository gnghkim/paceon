import type { ProgressEvent } from '@paceon/shared';

/**
 * 챕터형 자료의 진도. 완료 표시용 칼럼은 없고 기록이 곧 사실이다.
 * 그 챕터에 무효화되지 않은 학습 기록이 있으면 완료다. DB 함수와 같은 규칙이다.
 */

type EventLike = Pick<
  ProgressEvent,
  'id' | 'unit_id' | 'event_type' | 'voids_event_id' | 'study_date' | 'duration_minutes' | 'memo' | 'created_at'
>;

const voidedIds = (events: readonly EventLike[]) =>
  new Set(events.filter((event) => event.event_type === 'VOID' && event.voids_event_id).map((event) => event.voids_event_id!));

/** 완료한 챕터와 그때의 기록. 취소한 것은 빠진다. */
export function completedUnits<T extends EventLike>(events: readonly T[]): Map<string, T> {
  const voided = voidedIds(events);
  const done = new Map<string, T>();
  for (const event of events) {
    if (event.event_type !== 'LEARNING' || !event.unit_id || voided.has(event.id)) continue;
    const current = done.get(event.unit_id);
    if (!current || event.created_at > current.created_at) done.set(event.unit_id, event);
  }
  return done;
}

export interface UnitStudy {
  id: string;
  kind: 'FIRST' | 'AGAIN';
  studyDate: string;
  minutes: number | null;
  memo: string | null;
}

/**
 * 한 챕터를 공부한 이력. 처음 한 것과 다시 한 것을 날짜순으로 돌려준다.
 * 취소한 기록은 보이지 않는다. 다시 공부한 기록은 취소와 상관없이 남는다.
 */
export function unitStudies(events: readonly EventLike[], unitId: string): UnitStudy[] {
  const voided = voidedIds(events);
  return events
    .filter(
      (event) =>
        event.unit_id === unitId &&
        (event.event_type === 'LEARNING' || event.event_type === 'REVIEW') &&
        !voided.has(event.id),
    )
    .sort((a, b) => a.study_date.localeCompare(b.study_date) || a.created_at.localeCompare(b.created_at))
    .map((event) => ({
      id: event.id,
      kind: event.event_type === 'LEARNING' ? ('FIRST' as const) : ('AGAIN' as const),
      studyDate: event.study_date,
      minutes: event.duration_minutes,
      memo: event.memo,
    }));
}

/** 자료 하나의 진도 요약. 퍼센트는 내림한다. 하나 남았는데 100%로 보이면 안 된다. */
export function unitProgress(total: number, done: number) {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeDone = Math.min(safeTotal, Math.max(0, Math.trunc(done)));
  return {
    done: safeDone,
    total: safeTotal,
    percent: safeTotal ? Math.floor((safeDone / safeTotal) * 100) : 0,
  };
}

export interface Stall {
  title: string;
  minutes: number | null;
  scheduledOn: string;
  /** 앞 챕터의 일정에서 며칠이나 뒤로 밀렸는지 */
  gapDays: number;
}

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * 일정이 한참 뒤로 밀린 챕터를 찾는다.
 *
 * 챕터는 순서대로, 그날 남은 시간에 들어갈 때만 담긴다. 긴 챕터 하나가 하루에 남는
 * 시간보다 길면 다른 계획이 끝날 때까지 몇 달씩 밀릴 수 있다. 규칙대로의 결과지만
 * 말없이 그렇게 돼 있으면 고장처럼 보인다. 앞 챕터에서 두 주 넘게 벌어진 첫 챕터를
 * 돌려주어 화면이 이유와 고칠 방법을 말할 수 있게 한다.
 */
export function findStall(
  units: readonly { title: string; minutes: number | null; done: boolean; section: boolean; scheduledOn: string | null }[],
  today: string,
  thresholdDays = 14,
): Stall | null {
  let previous = today;
  for (const unit of units) {
    if (unit.section || unit.done || !unit.scheduledOn) continue;
    const gapDays = dayNumber(unit.scheduledOn) - dayNumber(previous);
    if (gapDays > thresholdDays)
      return { title: unit.title, minutes: unit.minutes, scheduledOn: unit.scheduledOn, gapDays };
    previous = unit.scheduledOn;
  }
  return null;
}
