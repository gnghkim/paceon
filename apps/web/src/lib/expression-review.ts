import { addDays } from '@paceon/scheduler';

/**
 * 표현 복습 간격(일). 제품 기본값이며, 누구에게나 최적인 주기라는 주장이 아니다.
 * 간격을 두고 기억에서 꺼내 보는 연습을 설계 원칙으로 삼는다.
 */
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;

/** 한 번에 보여 주는 복습 카드 수. 밀린 개수는 세어 보여 주지 않는다. */
export const DAILY_REVIEW_SIZE = 3;

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

export interface ExpressionCard {
  id: string;
  phrase: string;
  /** AI가 아직 채우지 않았으면 빈 문자열이다. */
  meaning: string;
  examples: string[];
  review_step: number;
  due_on: string;
  /** DONE만 복습에 나온다. 물어볼 뜻이 없는 카드는 내보내지 않는다. */
  lookup: 'DONE' | 'PENDING' | 'FAILED';
}

/**
 * 오늘 물어볼 카드. 예정일이 지난 것부터 오래된 순으로 고른다.
 * 밀린 카드가 아무리 많아도 한 번에 보여 주는 수는 같다.
 */
export function dueToday(
  cards: readonly ExpressionCard[],
  today: string,
  size = DAILY_REVIEW_SIZE,
): ExpressionCard[] {
  return cards
    .filter(card => card.due_on <= today)
    .sort((a, b) => a.due_on.localeCompare(b.due_on) || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, size));
}

/** 뜻을 먼저 보여 주지 않는다. 표현을 보고 뜻을 떠올리게 한다. */
export const reviewPrompt = (card: Pick<ExpressionCard, 'phrase'>) =>
  `${card.phrase}는 무슨 뜻이었나요?`;
