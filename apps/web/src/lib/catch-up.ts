import type { WorkspaceData } from './workspace-types.ts';
import { sessionState } from './session-state.ts';

export interface CatchUpTarget {
  resourceId: string;
  title: string;
  planId: string;
  expectedPlanVersion: number;
  expectedProgressVersion: number;
  /** 지난 일정 중 아직 읽지 않은 분량. 안내 문구에만 쓴다. */
  missedPages: number;
}

/**
 * 지난 학습일을 그냥 지나친 책을 찾는다.
 * 기록 없이 며칠이 지나면 일정이 과거에 그대로 남아 오늘 화면이 현실과 어긋난다.
 * 여기서 찾은 책만 재계획을 한 번 돌려 남은 분량을 내일 이후로 다시 나눈다.
 *
 * 이미 조정이 필요한 책(replan_required)은 사용자가 설정을 확인해야 하므로 건드리지 않는다.
 * 일시 정지·완료된 계획도 제외한다.
 */
export function catchUpTargets(data: WorkspaceData): CatchUpTarget[] {
  const targets: CatchUpTarget[] = [];
  for (const plan of data.plans) {
    if (plan.status !== 'ACTIVE') continue;
    const book = data.resources.find(resource => resource.id === plan.resource_id);
    if (!book || book.replan_required || book.status !== 'ACTIVE') continue;
    const completed = data.progress[book.id]?.completedThroughPage ?? 0;
    let missedPages = 0;
    for (const session of data.sessions) {
      if (session.plan_id !== plan.id || session.study_date >= data.today) continue;
      if (session.status === 'SKIPPED') continue;
      const state = sessionState(session, completed, data.today);
      if (state.kind === 'MISSED' || state.kind === 'IN_PROGRESS')
        missedPages += state.remainingPages;
    }
    if (missedPages > 0)
      targets.push({
        resourceId: book.id,
        title: book.title,
        planId: plan.id,
        expectedPlanVersion: plan.version,
        expectedProgressVersion: book.progress_version,
        missedPages,
      });
  }
  return targets;
}

/**
 * 하루에 한 번만 정리한다. 같은 날 다시 열면 이미 정리한 것으로 보고 건너뛴다.
 * 멱등성 키를 함께 보관해 실패 후 재시도가 중복 기록을 만들지 않게 한다.
 */
export const CATCH_UP_KEY = 'paceon:catch-up';

export interface CatchUpMemory {
  date: string;
  keys: Record<string, string>;
}

export function readCatchUpMemory(raw: string | null, today: string): CatchUpMemory {
  try {
    const saved = raw ? (JSON.parse(raw) as CatchUpMemory) : null;
    if (saved && saved.date === today && saved.keys && typeof saved.keys === 'object')
      return { date: today, keys: { ...saved.keys } };
  } catch {
    /* 손상된 값은 오늘 처음 여는 것으로 본다. */
  }
  return { date: today, keys: {} };
}

/** 오늘 이 계획을 이미 정리했는지. 값이 있으면 그 키로 재시도한다. */
export const catchUpKey = (memory: CatchUpMemory, planId: string) => memory.keys[planId];
