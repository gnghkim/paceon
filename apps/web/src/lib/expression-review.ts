import { addDays } from '@paceon/scheduler';

/**
 * 표현 복습 간격(일). 제품 기본값이며, 누구에게나 최적인 주기라는 주장이 아니다.
 * 간격을 두고 기억에서 꺼내 보는 연습을 설계 원칙으로 삼는다.
 */
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;

/** 한 번에 보여 주는 복습 카드 수. 밀린 개수는 세어 보여 주지 않는다. */
export const DAILY_REVIEW_SIZE = 3;

/** Completion is only confirmed after grading and a fresh successful due-count query. */
export function reviewStatus(summary: { saved: number; due: number } | null, graded = 0, failed = false) {
  if (failed) return 'error';
  if (!summary) return 'loading';
  if (summary.due > 0) return 'ready';
  if (graded > 0) return 'complete';
  return summary.saved > 0 ? 'scheduled' : 'empty';
}

export const reviewStatusLabel = {
  loading: '복습을 불러오는 중…',
  error: '복습을 불러오지 못했어요',
  ready: '읽은 것과 담아 둔 단어를 다시 꺼내 봐요',
  complete: '오늘 복습 완료',
  scheduled: '오늘 예정된 복습이 없어요',
  empty: '복습할 내용을 아직 담지 않았어요',
} as const;

export type ReviewGrade = 'HARD' | 'OK' | 'EASY';

export interface ReviewState {
  /** 0부터 REVIEW_INTERVALS.length - 1까지. 지금 쓰는 간격의 위치다. */
  step: number;
  dueOn: string;
}

const clampStep = (step: number) =>
  Number.isInteger(step) ? Math.min(Math.max(step, 0), REVIEW_INTERVALS.length - 1) : 0;

/** 막 저장한 표현의 첫 예정일. 저장한 날 바로 묻지 않고 하루 뒤부터 시작한다. */
export function firstReview(today: string): ReviewState {
  return { step: 0, dueOn: addDays(today, REVIEW_INTERVALS[0]!) };
}

/**
 * 답한 뒤의 다음 예정일.
 *
 * - 어려움: 처음 간격으로 돌아가 내일 다시 묻는다.
 * - 보통: 지금 간격을 유지한다.
 * - 쉬움: 다음 간격으로 넘어간다. 마지막 간격에서는 그대로 머문다.
 */
export function nextReview(step: number, grade: ReviewGrade, today: string): ReviewState {
  const current = clampStep(step);
  const next =
    grade === 'HARD' ? 0 : grade === 'EASY' ? Math.min(current + 1, REVIEW_INTERVALS.length - 1) : current;
  return { step: next, dueOn: addDays(today, REVIEW_INTERVALS[next]!) };
}

export type CardKind = 'EXPRESSION' | 'RECALL';

export interface ExpressionCard {
  id: string;
  /** 표현은 뜻을 묻고, 회상은 그 범위에서 기억나는 것을 묻는다. 간격 규칙은 같다. */
  kind: CardKind;
  /** 회상 카드가 가리키는 책. 표현 카드는 null이다. */
  resource_id: string | null;
  phrase: string;
  /** AI가 아직 채우지 않았으면 빈 문자열이다. */
  meaning: string;
  examples: string[];
  review_step: number;
  due_on: string;
  /** DONE만 복습에 나온다. 물어볼 뜻이 없는 카드는 내보내지 않는다. */
  lookup: 'DONE' | 'PENDING' | 'FAILED';
}

const oldestFirst = (a: ExpressionCard, b: ExpressionCard) =>
  a.due_on.localeCompare(b.due_on) || a.id.localeCompare(b.id);

/**
 * 오늘 물어볼 카드. 밀린 카드가 아무리 많아도 한 번에 보여 주는 수는 같다.
 *
 * 종류마다 오래된 순으로 줄을 세우고 번갈아 뽑는다. 예정일 순으로만 고르면 밀린
 * 단어 수십 개가 앞을 막아 오늘 읽은 책의 회상이 몇 주 뒤에야 나온다. 그 사이
 * 기억은 다시 배워야 할 만큼 흐려진다. 가장 오래 기다린 종류부터 시작한다.
 */
export function dueToday(
  cards: readonly ExpressionCard[],
  today: string,
  size = DAILY_REVIEW_SIZE,
): ExpressionCard[] {
  const queues = new Map<CardKind, ExpressionCard[]>();
  for (const card of cards) {
    if (card.due_on > today) continue;
    const queue = queues.get(card.kind);
    if (queue) queue.push(card);
    else queues.set(card.kind, [card]);
  }
  const lines = [...queues.values()]
    .map(queue => queue.sort(oldestFirst))
    .sort((a, b) => oldestFirst(a[0]!, b[0]!));
  const picked: ExpressionCard[] = [];
  const limit = Math.max(0, size);
  while (picked.length < limit && lines.some(line => line.length > 0))
    for (const line of lines) {
      const next = line.shift();
      if (next) picked.push(next);
      if (picked.length >= limit) break;
    }
  return picked;
}

/**
 * 답을 먼저 보여 주지 않는다. 표현은 뜻을, 회상은 그 범위에서 기억나는 것을
 * 떠올리게 한다.
 */
export const reviewPrompt = (card: Pick<ExpressionCard, 'phrase'> & { kind?: CardKind }) =>
  card.kind === 'RECALL'
    ? '책을 펼치지 말고, 이 범위에서 기억나는 것을 떠올려 보세요.'
    : `${card.phrase}는 무슨 뜻이었나요?`;
