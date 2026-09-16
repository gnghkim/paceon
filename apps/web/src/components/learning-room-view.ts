import type { LearningKind, LearningSession, LearningSnapshot, LearningVideoVisit } from './learning-types';

const IDLE_MS = 60_000;

export type TimerView = { device: string; lastActivity: number; pendingEnd: boolean };

// Keeps the first position of each id and the value of its last occurrence.
const byId = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
const byCreated = <T extends { created_at: string }>(items: T[]) => items.sort((a, b) => a.created_at.localeCompare(b.created_at));

/** `pages[0]` is the live snapshot, followed by older history pages. */
export function mergeLearningPages(pages: readonly LearningSnapshot[]) {
  // Job and session status changes, so the live snapshot's copy must win.
  const liveLast = [...pages].reverse();
  return {
    messages: byCreated(byId(pages.flatMap(page => page.messages))),
    jobs: byCreated(byId(liveLast.flatMap(page => page.jobs))),
    sessions: byId(liveLast.flatMap(page => page.sessions)),
    videoNotes: byId(pages.flatMap(page => page.videoNotes ?? [])),
    videoVisits: byId(pages.flatMap(page => page.videoVisits ?? [])),
    hasMore: Object.values(pages.at(-1)?.hasMore ?? {}).some(Boolean),
  };
}

/** Seconds not yet confirmed by the server, and whether the active lease looks stale. */
export function sessionTiming(current: LearningSession | null, view: TimerView, now: number) {
  if (current?.status !== 'ACTIVE') return { provisional: 0, stale: false };
  const lease = Date.parse(current.lease_expires_at), lastSeen = Date.parse(current.last_seen_at), idle = now - view.lastActivity;
  const counting = current.device_id === view.device && !view.pendingEnd && idle < IDLE_MS && now < lease;
  return {
    provisional: counting ? Math.max(0, Math.min(15, (now - lastSeen) / 1000)) : 0,
    stale: now >= lease || idle >= IDLE_MS || now - lastSeen > 30_000,
  };
}

/**
 * 화면이 보이는 상태에서 영상을 재생하면 정지한 세션을 재개한다.
 * 사용자가 직접 정지한 경우도 포함한다. 재생은 명시적인 학습 의사이기 때문이다.
 * 메모·글 입력은 이 경로를 쓰지 않으므로 수동 정지를 깨우지 않는다.
 */
export const playResumesPause = (session: LearningSession | null, visible: boolean) =>
  visible && session?.status === 'PAUSED';

export type MergedVideoVisit = LearningVideoVisit & { parts: number };

/** 이어진 시청으로 볼 최대 간격(초). 서버가 약 10초 간격으로 구간을 남기므로 그보다 짧게 둔다. */
const VISIT_GAP_SECONDS = 2;
const visitDay = (visit: LearningVideoVisit) => visit.created_at.slice(0, 10);

/**
 * 끊겨 기록된 시청 구간을 읽기 좋게 합친다.
 * 같은 날·같은 배속이고 끝점과 시작점이 2초 이내로 이어지거나 겹칠 때만 한 줄로 만든다.
 * 최근 날짜가 먼저 오고, 같은 날 안에서는 영상 위치 순으로 정렬한다.
 */
export function mergeVideoVisits(visits: readonly LearningVideoVisit[]): MergedVideoVisit[] {
  const ordered = [...visits].sort((a, b) =>
    visitDay(b).localeCompare(visitDay(a)) || a.rate - b.rate || a.from_seconds - b.from_seconds);
  const merged: MergedVideoVisit[] = [];
  for (const visit of ordered) {
    const last = merged.at(-1);
    if (last && visitDay(last) === visitDay(visit) && last.rate === visit.rate
      && visit.from_seconds <= last.to_seconds + VISIT_GAP_SECONDS) {
      last.to_seconds = Math.max(last.to_seconds, visit.to_seconds);
      last.parts += 1;
      continue;
    }
    merged.push({ ...visit, parts: 1 });
  }
  return merged;
}

export type LearningRoomTab = 'video' | 'speak' | 'ask' | 'source';

const roomTabsByKind: Record<LearningKind, readonly { id: LearningRoomTab; label: string }[]> = {
  LISTENING: [
    { id: 'video', label: '영상·메모' },
    { id: 'speak', label: '말하기' },
    { id: 'ask', label: '질문·노트' },
    { id: 'source', label: '자료' },
  ],
  SPEAKING: [{ id: 'speak', label: '말하기' }],
  WRITING: [{ id: 'ask', label: '질문·노트' }],
};

/** 방 종류가 가진 활동 탭. 길이가 1이면 탭 바를 그리지 않는다. */
export const roomTabs = (kind: LearningKind) => roomTabsByKind[kind];

/** 주소의 view 값을 그 방에 있는 탭으로 바꾼다. 없거나 모르는 값은 첫 탭이다. */
export function resolveRoomTab(kind: LearningKind, view: string | null): LearningRoomTab {
  const tabs = roomTabs(kind);
  return tabs.find(tab => tab.id === view)?.id ?? tabs[0]!.id;
}

const startHints: Record<LearningKind, string> = {
  LISTENING: '재생하거나 글을 쓰면 시작돼요',
  SPEAKING: '녹음하거나 음성을 들으면 시작돼요',
  WRITING: '글을 쓰면 시작돼요',
};

export function timerStatusLabel({ locked, pendingEnd, current, stale, kind }: {
  locked: boolean; pendingEnd: boolean; current: LearningSession | null; stale: boolean; kind: LearningKind;
}) {
  if (locked) return '다른 기기에서 학습 중';
  if (pendingEnd) return '종료 동기화 대기';
  if (!current) return startHints[kind];
  if (current.status === 'ENDED') return '학습 종료 · 기록됨';
  if (current.status === 'PAUSED' || stale) return '일시 정지';
  return '학습 중 · 시간 동기화 중';
}

export const sessionStatusLabel = (status: LearningSession['status']) =>
  status === 'ENDED' ? '종료' : status === 'PAUSED' ? '일시 정지' : '진행 중';
