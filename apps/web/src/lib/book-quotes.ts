/**
 * 문장 기록.
 *
 * 책을 읽다가, 또는 읽고 나서 남기고 싶은 문장을 쪽과 함께 적어 둔다. 회상 카드와
 * 다르다. 회상은 책을 덮고 떠올린 내 말이라 복습에서 다시 묻고, 문장은 책에 있는
 * 그대로라 모아 두고 다시 펼쳐 본다. 복습에 넣지 않는다.
 */

import type { ReadingPosition } from './reading-timer.ts';

export const MAX_QUOTE_LENGTH = 2000;

export interface BookQuote {
  id: string;
  page: number;
  content: string;
  /** 그 문장에 붙인 내 생각. 없으면 null이다. */
  note: string | null;
  createdOn: string;
}

/**
 * 적은 것을 저장할 모양으로 다듬는다. 남길 것이 없거나 너무 길면 null이다.
 * 시나 대화처럼 줄이 뜻을 가진 문장이 있어 줄바꿈은 살리고, 겹친 빈 줄만 줄인다.
 * 너무 길면 자르지 않는다. 문장의 끝이 조용히 사라지는 쪽이 더 나쁘다.
 */
export function normalizeQuoteText(raw: string): string | null {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text || text.length > MAX_QUOTE_LENGTH) return null;
  return text;
}

/** 쓸 수 있는 쪽인지. 책의 쪽 수를 모르면 아래쪽만 본다. */
export function validQuotePage(page: unknown, totalPages: number | null): page is number {
  return (
    Number.isInteger(page) &&
    (page as number) >= 1 &&
    (page as number) <= (totalPages ?? 1_000_000)
  );
}

/** 책의 순서대로. 같은 쪽이면 먼저 남긴 것이 먼저다. */
export function sortQuotes<T extends { page: number; createdOn: string; id: string }>(quotes: T[]): T[] {
  return [...quotes].sort(
    (a, b) => a.page - b.page || a.createdOn.localeCompare(b.createdOn) || a.id.localeCompare(b.id),
  );
}

/**
 * 쪽 칸에 미리 넣을 값. 이번에 방금 남긴 쪽이 있으면 그 쪽이다. 같은 자리에서
 * 몇 문장을 이어 남기는 일이 흔하다. 없으면 지난번 읽은 다음 쪽, 다 읽은 책이면
 * 고르지 않는다. 어디를 다시 읽는지 알 수 없다.
 */
export function suggestQuotePage(position: ReadingPosition | null, lastUsed: number | undefined): number | null {
  if (lastUsed !== undefined) return lastUsed;
  if (!position || position.finished) return null;
  const next = position.lastPage + 1;
  return position.totalPages !== null ? Math.min(next, position.totalPages) : next;
}
