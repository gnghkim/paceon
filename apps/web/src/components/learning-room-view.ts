import type { LearningKind, LearningSession, LearningSnapshot } from './learning-types';

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
