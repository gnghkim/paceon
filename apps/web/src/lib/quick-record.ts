import type { WorkspaceData } from './workspace-types';
import { readingState } from './reading-state.ts';

type Recordable = {
  book: WorkspaceData['resources'][number];
  plan: WorkspaceData['plans'][number] | null;
};

/**
 * 기록 창에 보일 책. 지금 읽는 책과 다시 읽는 책뿐이다. 서재에 담기만 한 책과 다 읽은
 * 책은 서재에서 독서 시작이나 재독 시작을 눌러야 나온다. 계획이 아직 없어도 읽기 시작한
 * 책은 넣는다. 도서 화면에서 계획 없이 타이머를 켤 수 있으니, 끄고 나서 그 책을 고를 수
 * 없으면 잰 시간이 갈 곳이 없다.
 */
export function recordableBooks(
  data: Pick<WorkspaceData, 'resources' | 'plans' | 'sessions' | 'today'>,
): Recordable[] {
  const today = new Set(
    data.sessions
      .filter((s) => s.study_date === data.today && s.status !== 'SKIPPED')
      .map((s) => s.resource_id),
  );
  return data.resources
    .flatMap((book): Recordable[] => {
      if (book.type !== 'BOOK') return [];
      const state = readingState(book);
      if (state !== 'READING' && state !== 'REREADING') return [];
      const plans = data.plans.filter((p) => p.resource_id === book.id);
      // A paused current plan must not fall back to completed history.
      const current = plans.find(
        (p) => p.status === 'ACTIVE' || p.status === 'PAUSED',
      );
      if (current) return current.status !== 'PAUSED' ? [{ book, plan: current }] : [];
      const finished = plans
        .filter((p) => p.status === 'COMPLETED')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return [{ book, plan: finished ?? null }];
    })
    .sort(
      (a, b) => Number(today.has(b.book.id)) - Number(today.has(a.book.id)),
    );
}

/**
 * 기록 창을 열 때 처음 골라 둘 책. 부른 쪽이 책을 정했으면 그 책이다. 상단 단추처럼
 * 책 없이 열었는데 책을 재는 중이면 그 책을 골라 둔다. 챕터를 재는 중이면 이 창과
 * 상관없으므로 고르지 않는다.
 */
export function initialRecordBook(
  bookId: string | undefined,
  running: { resourceId: string; unit?: unknown } | null,
): string {
  if (bookId !== undefined) return bookId;
  return running && !running.unit ? running.resourceId : '';
}

export const WORKSPACE_CHANGED = 'paceon:workspace-changed';
