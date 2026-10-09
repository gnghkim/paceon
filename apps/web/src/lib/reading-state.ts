/**
 * 책의 읽기 상태. 독서 기록 창에는 지금 읽는 책과 다시 읽는 책만 보인다.
 * 서재에 담기만 한 책은 독서 시작을, 다 읽은 책은 재독 시작을 눌러야 그 창에 나온다.
 * 재독은 복습 기록으로 남고, 마지막 쪽까지 다시 읽으면 저절로 끝난다.
 */

import type { ProgressEvent, Resource } from '@paceon/shared';

export type ReadingState = 'NOT_STARTED' | 'READING' | 'FINISHED' | 'REREADING' | 'ARCHIVED';
type StateBook = Pick<Resource, 'status' | 'reading_started_at' | 'rereading_since'>;

export function readingState(book: StateBook): ReadingState {
  if (book.status === 'ARCHIVED') return 'ARCHIVED';
  if (book.status === 'COMPLETED') return book.rereading_since ? 'REREADING' : 'FINISHED';
  return book.reading_started_at ? 'READING' : 'NOT_STARTED';
}

/** 서재와 도서 상세에 붙이는 말. */
export const readingStateLabel: Record<ReadingState, string> = {
  NOT_STARTED: '읽기 전',
  READING: '읽는 중',
  FINISHED: '완독',
  REREADING: '재독 중',
  ARCHIVED: '보관',
};

export type ReadingChange = 'START' | 'REREAD' | 'STOP_REREAD';

/**
 * 바꿀 수 있는지와 바꾼 뒤의 칸. 이미 그 상태면 아무것도 바꾸지 않는다(null).
 * 할 수 없는 일이면 사용자에게 보일 이유를 던진다.
 */
export function planReadingChange(
  book: StateBook,
  change: ReadingChange,
  now: string,
): Partial<Pick<Resource, 'reading_started_at' | 'rereading_since'>> | null {
  const state = readingState(book);
  if (state === 'ARCHIVED') throw new Error('보관한 책이에요. 먼저 서재로 되돌려 주세요.');
  if (change === 'START') {
    if (state !== 'NOT_STARTED') return null;
    return { reading_started_at: now };
  }
  if (change === 'REREAD') {
    if (state === 'REREADING') return null;
    if (state !== 'FINISHED') throw new Error('다 읽은 책만 다시 읽을 수 있어요.');
    return { rereading_since: now };
  }
  return state === 'REREADING' ? { rereading_since: null } : null;
}

type ReviewEvent = Pick<ProgressEvent, 'id' | 'event_type' | 'voids_event_id' | 'end_page' | 'created_at'>;

/**
 * 재독 기록을 시작할 쪽. 이번 재독에서 마지막으로 다시 읽은 쪽의 다음 쪽이다.
 * 처음이거나 재독 중이 아니면 1쪽이다.
 */
export function rereadStartPage(
  book: Pick<Resource, 'rereading_since' | 'total_pages'>,
  events: readonly ReviewEvent[],
): number {
  if (!book.rereading_since) return 1;
  const since = Date.parse(book.rereading_since);
  const voided = new Set(events.filter((event) => event.event_type === 'VOID').map((event) => event.voids_event_id));
  const reached = events
    .filter(
      (event) =>
        event.event_type === 'REVIEW' && !voided.has(event.id) && Date.parse(event.created_at) >= since,
    )
    .reduce((last, event) => Math.max(last, event.end_page ?? 0), 0);
  return Math.min(reached + 1, book.total_pages ?? reached + 1);
}

/** 이 복습으로 재독이 끝나는지. 마지막 쪽까지 다시 읽으면 끝난다. DB 트리거와 같은 규칙이다. */
export function endsReread(
  book: Pick<Resource, 'rereading_since' | 'total_pages'>,
  kind: string,
  endPage: number,
): boolean {
  return !!book.rereading_since && kind === 'REVIEW' && book.total_pages !== null && endPage >= book.total_pages;
}
