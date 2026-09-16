import type { ScheduleSession } from '@paceon/shared';
import type { WorkspaceData } from './workspace-types.ts';

/**
 * 화면에 보여 줄 일정 상태.
 * DB의 session_status는 기록을 저장할 때만 갱신되므로, 읽은 진도에서 직접 계산해
 * 저장 직후와 밀린 날에도 같은 결과가 나오게 한다. 계산 규칙은 재계획 함수와 같다.
 * MISSED는 저장된 SKIPPED와 달리 "지난 날인데 아직 안 읽음"을 뜻한다.
 */
export type SessionStateKind = 'COMPLETED' | 'IN_PROGRESS' | 'MISSED' | 'PLANNED';
export interface SessionState {
  kind: SessionStateKind;
  donePages: number;
  remainingPages: number;
}

type SessionLike = Pick<
  ScheduleSession,
  'resource_id' | 'study_date' | 'start_page' | 'end_page' | 'planned_workload' | 'estimated_minutes' | 'status'
>;

export function sessionState(
  session: SessionLike,
  completedThroughPage: number,
  today: string,
): SessionState {
  const { start_page: start, end_page: end } = session;
  const past = session.study_date < today;
  // 페이지 범위가 없는 일정은 스스로 진도를 판단할 수 없어 저장된 상태를 따른다.
  if (start === null || end === null) {
    const stored = session.status;
    if (stored === 'COMPLETED') return { kind: 'COMPLETED', donePages: 0, remainingPages: 0 };
    if (stored === 'IN_PROGRESS') return { kind: 'IN_PROGRESS', donePages: 0, remainingPages: 0 };
    return { kind: past ? 'MISSED' : 'PLANNED', donePages: 0, remainingPages: 0 };
  }
  const planned = end - start + 1;
  if (completedThroughPage >= end) return { kind: 'COMPLETED', donePages: planned, remainingPages: 0 };
  if (completedThroughPage >= start) {
    const donePages = completedThroughPage - start + 1;
    return { kind: 'IN_PROGRESS', donePages, remainingPages: planned - donePages };
  }
  return { kind: past ? 'MISSED' : 'PLANNED', donePages: 0, remainingPages: planned };
}

export interface DaySummary {
  total: number;
  completed: number;
  allDone: boolean;
  donePages: number;
  remainingPages: number;
  remainingMinutes: number;
}

/** 하루치 일정을 한 줄로 요약한다. SKIPPED는 화면에서 제외하므로 여기서도 세지 않는다. */
export function summarizeDay(
  sessions: readonly SessionLike[],
  progress: WorkspaceData['progress'] | Record<string, { completedThroughPage: number }>,
  today: string,
): DaySummary {
  const visible = sessions.filter(session => session.status !== 'SKIPPED');
  let completed = 0;
  let donePages = 0;
  let remainingPages = 0;
  let remainingMinutes = 0;
  for (const session of visible) {
    const state = sessionState(session, progress[session.resource_id]?.completedThroughPage ?? 0, today);
    if (state.kind === 'COMPLETED') completed++;
    donePages += state.donePages;
    remainingPages += state.remainingPages;
    const planned = state.donePages + state.remainingPages;
    // 남은 시간은 남은 분량에 비례해 추정한다. 저장된 예상 시간은 일정 전체 기준이다.
    if (planned > 0 && session.estimated_minutes !== null)
      remainingMinutes += Math.ceil((session.estimated_minutes * state.remainingPages) / planned);
  }
  return {
    total: visible.length,
    completed,
    allDone: visible.length > 0 && completed === visible.length,
    donePages,
    remainingPages,
    remainingMinutes,
  };
}
