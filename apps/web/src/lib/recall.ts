/**
 * 독서 회상 카드.
 *
 * 읽은 직후 책을 덮고 떠올린 것을 적어 두면, 간격을 두고 같은 범위를 다시 묻는다.
 * 다시 읽는 것은 익숙함을 남기고 꺼내는 것은 기억을 남긴다. 옮겨 적는 메모와
 * 다른 점은 시점이다. 이것은 책을 덮은 뒤에 쓴다.
 *
 * 답은 사용자가 직접 적은 것이다. AI가 요약해 채우지 않는다. 남이 만든 카드는
 * 남의 기억 구조다.
 */

export const MAX_RECALL_LENGTH = 500;
const MAX_PROMPT_LENGTH = 200;

/**
 * 적은 것을 저장할 모양으로 다듬는다. 남길 것이 없으면 null이다.
 * 줄바꿈은 살린다. 세 가지를 세 줄로 적는 일이 흔하다. 빈 줄이 겹친 것만 줄인다.
 */
export function normalizeRecall(raw: string): string | null {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text || text.length > MAX_RECALL_LENGTH) return null;
  return text;
}

export interface PageRange {
  startPage: number;
  endPage: number;
}

/** 쓸 수 있는 쪽 범위인지. 하나만 있거나 거꾸로 된 범위는 범위가 없는 것으로 친다. */
export function validRange(start: unknown, end: unknown): PageRange | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  const startPage = start as number;
  const endPage = end as number;
  if (startPage < 1 || endPage < startPage || endPage > 1_000_000) return null;
  return { startPage, endPage };
}

export const rangeLabel = (range: PageRange) =>
  range.startPage === range.endPage
    ? `${range.startPage}쪽`
    : `${range.startPage}–${range.endPage}쪽`;

/**
 * 복습 때 보여 줄 앞면. 책 제목과 범위만 말하고 내용의 단서는 주지 않는다.
 * 제목이 길면 제목을 줄인다. 범위는 어디를 떠올릴지 알려 주는 유일한 단서라 남긴다.
 */
export function recallPrompt(title: string, range: PageRange | null, unitTitle?: string): string {
  // 챕터로 공부하는 자료는 쪽 범위 대신 챕터 이름이 어디를 떠올릴지 알려 준다.
  const where = unitTitle?.replace(/\s+/g, ' ').trim().slice(0, 120) || (range ? rangeLabel(range) : '');
  const suffix = where ? ` · ${where}` : '';
  const room = MAX_PROMPT_LENGTH - suffix.length;
  const clean = title.replace(/\s+/g, ' ').trim() || '책';
  const shown = clean.length > room ? `${clean.slice(0, room - 1).trimEnd()}…` : clean;
  return `${shown}${suffix}`;
}

/**
 * 기록한 직후 어떤 범위를 떠올리게 할지.
 * 새로 읽은 기록은 이전에 읽은 곳 다음 쪽부터 방금 적은 쪽까지다. 복습 기록은
 * 적어 넣은 범위 그대로다. 정정은 읽은 것이 아니므로 묻지 않는다.
 */
export function rangeForRecord(
  kind: 'LEARNING' | 'REVIEW' | 'CORRECTION',
  previousThroughPage: number,
  input: { startPage?: number; endPage: number },
): PageRange | null {
  if (kind === 'CORRECTION') return null;
  if (kind === 'REVIEW') return validRange(input.startPage, input.endPage);
  return validRange(previousThroughPage + 1, input.endPage);
}
