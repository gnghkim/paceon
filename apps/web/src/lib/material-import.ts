import { z } from 'zod';
import type { OutlineItem } from './unit-outline.ts';
import { suggestDefaultMinutes } from './unit-outline.ts';

/**
 * 링크에서 가져온 제안을 다루는 순수 로직.
 *
 * AI가 낸 것은 제안이다. 저장된 결과라도 그대로 믿지 않고 여기서 다시 모양을 확인하며,
 * 하루 분량은 사용자가 실제로 낼 수 있는 시간 안으로 다시 맞춘다. 숫자에 관해서는
 * AI보다 산수가 믿을 만하다.
 */

const proposal = z
  .object({
    found: z.boolean(),
    title: z.string().max(300),
    kind: z.enum(['COURSE', 'TEXTBOOK']),
    unitLabel: z.string().trim().min(1).max(20),
    units: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(300),
          minutes: z.number().int().min(1).max(1440).nullable(),
          section: z.boolean(),
        }),
      )
      .max(600),
    plan: z.object({
      dailyUnits: z.number().int().min(1).max(20),
      minutesPerUnit: z.number().int().min(1).max(600),
      reason: z.string().trim().min(1).max(300),
    }),
  })
  .strip();

export interface ImportProposal {
  title: string;
  kind: 'COURSE' | 'TEXTBOOK';
  unitLabel: string;
  units: OutlineItem[];
  plan: { dailyUnits: number; minutesPerUnit: number; reason: string };
}

/** 저장된 AI 결과를 화면이 쓸 모양으로. 목차를 찾지 못했거나 모양이 어긋나면 null이다. */
export function readProposal(value: unknown): ImportProposal | null {
  const parsed = proposal.safeParse(value);
  if (!parsed.success || !parsed.data.found) return null;
  const units: OutlineItem[] = parsed.data.units.map((unit) =>
    unit.section
      ? { title: unit.title, section: true as const }
      : unit.minutes === null
        ? { title: unit.title }
        : { title: unit.title, minutes: unit.minutes },
  );
  // 딸린 챕터가 없는 묶음 제목은 뺀다.
  const kept = units.filter((unit, index) => !unit.section || (units[index + 1] && !units[index + 1]!.section));
  if (!kept.some((unit) => !unit.section)) return null;
  return {
    title: parsed.data.title.trim(),
    kind: parsed.data.kind,
    unitLabel: parsed.data.unitLabel,
    units: kept,
    plan: parsed.data.plan,
  };
}

interface SessionLike {
  study_date: string;
  estimated_minutes: number | null;
  status: string;
}

const weekdayOf = (date: string) => ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // 월=1 … 일=7
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * 요일마다 실제로 남는 학습 시간(월요일부터). 가용 시간에서 앞으로 네 주 동안 다른 계획이
 * 그 요일에 평균적으로 잡아 둔 시간을 뺀다. 가용 시간만 보면 책 두 권이 이미 하루를 다
 * 쓰고 있는 사람에게도 하루 세 강을 권하게 된다.
 */
export function freeMinutesByWeekday(
  availability: readonly { iso_weekday: number; available_minutes: number }[],
  sessions: readonly SessionLike[],
  today: string,
  weeks = 4,
): number[] {
  const booked = Array.from({ length: 7 }, () => 0);
  const start = dayNumber(today) + 1;
  const end = start + weeks * 7 - 1;
  for (const session of sessions) {
    const day = dayNumber(session.study_date);
    if (!Number.isFinite(day) || day < start || day > end || session.status === 'SKIPPED' || session.status === 'COMPLETED') continue;
    booked[weekdayOf(session.study_date) - 1]! += session.estimated_minutes ?? 0;
  }
  return Array.from({ length: 7 }, (_, index) => {
    const rule = availability.find((item) => item.iso_weekday === index + 1);
    const free = (rule?.available_minutes ?? 0) - Math.round(booked[index]! / weeks);
    return Math.max(0, Math.min(1440, free));
  });
}

/**
 * AI가 권한 하루 분량을 실제로 남는 시간 안으로 맞춘다.
 *
 * 공부하는 요일의 남는 시간 중 가운데 값을 "보통의 하루"로 보고, 그 안에 들어가는 개수를
 * 넘지 않게 한다. 바꿨으면 이유 문장도 바꾼다. AI의 문장이 숫자와 어긋난 채 남으면 안 된다.
 */
export function fitPlan(
  plan: ImportProposal['plan'],
  units: readonly OutlineItem[],
  free: readonly number[],
): ImportProposal['plan'] & { adjusted: boolean } {
  const typical = suggestDefaultMinutes(units) ?? plan.minutesPerUnit;
  const studyDays = free.filter((minutes) => minutes > 0).sort((a, b) => a - b);
  if (!studyDays.length) return { ...plan, adjusted: false };
  const usual = studyDays[Math.floor((studyDays.length - 1) / 2)]!;
  const fits = Math.max(1, Math.floor(usual / Math.max(1, typical)));
  if (plan.dailyUnits <= fits) return { ...plan, adjusted: false };
  return {
    dailyUnits: fits,
    minutesPerUnit: plan.minutesPerUnit,
    reason: `보통 하루에 남는 학습 시간이 ${usual}분이고 하나에 ${typical}분쯤 걸려서, 하루 ${fits}개로 줄였어요.`,
    adjusted: true,
  };
}

/** 페이지를 읽지 못한 이유를 사용자가 할 수 있는 일로 바꾼다. */
export const fetchErrorText: Record<string, string> = {
  INVALID_URL: '주소를 확인해 주세요. https://로 시작하는 페이지 주소여야 해요.',
  NOT_HTTPS: 'https://로 시작하는 주소만 읽을 수 있어요.',
  HAS_CREDENTIALS: '아이디나 비밀번호가 들어 있는 주소는 읽지 않아요.',
  BAD_PORT: '이 주소는 읽을 수 없어요. 일반적인 웹 페이지 주소를 넣어 주세요.',
  IP_LITERAL: '숫자로 된 주소는 읽지 않아요. 사이트의 페이지 주소를 넣어 주세요.',
  LOCAL_NAME: '이 주소는 읽을 수 없어요. 공개된 웹 페이지 주소를 넣어 주세요.',
  PRIVATE_ADDRESS: '이 주소는 읽을 수 없어요. 공개된 웹 페이지 주소를 넣어 주세요.',
  TOO_MANY_REDIRECTS: '페이지가 계속 다른 곳으로 넘겨서 읽지 못했어요. 목차를 복사해 붙여 넣어 주세요.',
  NOT_HTML: '웹 페이지가 아니에요. 강의나 책의 소개 페이지 주소를 넣어 주세요.',
  TOO_LARGE: '페이지가 너무 커서 읽지 못했어요. 목차를 복사해 붙여 넣어 주세요.',
  TIMEOUT: '페이지가 응답하지 않았어요. 잠시 후 다시 시도하거나 목차를 복사해 붙여 넣어 주세요.',
  HTTP_ERROR: '페이지를 열지 못했어요. 로그인이 필요한 페이지일 수 있어요. 목차를 복사해 붙여 넣어 주세요.',
  NETWORK: '페이지에 연결하지 못했어요. 주소를 확인하거나 목차를 복사해 붙여 넣어 주세요.',
};

const SECTION_PREFIX = /^(?:섹션|section|part|파트|chapter|챕터)\s*\d{1,3}\s*[.:)\-]?\s*/i;
const NUMBER_PREFIX = /^\d{1,4}\s*[.)]\s+/;

/**
 * AI는 "적힌 대로 옮겨라"를 글자 그대로 따라 "섹션 1."과 "3."까지 제목에 넣는다.
 * 순서는 우리가 따로 매기므로 앞의 번호는 뗀다. 떼고 나서 남는 것이 없으면 그대로 둔다.
 */
export function tidyTitles(units: readonly OutlineItem[]): OutlineItem[] {
  return units.map((unit) => {
    const stripped = unit.title.replace(unit.section ? SECTION_PREFIX : NUMBER_PREFIX, '').trim();
    return stripped ? { ...unit, title: stripped } : unit;
  });
}

const knownMinutes = (units: readonly OutlineItem[]) =>
  units.reduce((sum, unit) => sum + (unit.section ? 0 : (unit.minutes ?? 0)), 0);
const leafCount = (units: readonly OutlineItem[]) => units.filter((unit) => !unit.section).length;

/**
 * 규칙으로 뽑은 목차와 AI가 정리한 목차 중 더 온전한 쪽을 고른다.
 *
 * AI가 언제나 낫지는 않다. 실제 강의 페이지에서 AI는 접힌 섹션 넷을 통째로 빠뜨렸고
 * 규칙은 그것을 합계 시간을 가진 챕터로 살렸다. 더 나은 것을 AI의 것으로 덮어쓰면
 * 안 된다.
 *
 * - 길이를 아는 시간이 더 많은 쪽이 페이지를 더 많이 읽은 것이다.
 * - 읽은 시간이 같으면 규칙이다. 규칙은 페이지를 글자 그대로 옮기므로 지어낼 수 없고,
 *   AI는 같은 시간을 읽고도 묶음 제목을 빠뜨리거나 제목을 강의로 넣곤 했다.
 * - 둘 다 길이가 없으면(책의 목차) 챕터가 많은 쪽이고, 그마저 같으면 AI다. 길이가 없는
 *   목차에서는 규칙이 기댈 단서가 적고 AI가 제목을 더 잘 가른다.
 * - 규칙이 아무것도 못 뽑았으면 AI의 것이다.
 */
export function chooseOutline(
  ruled: readonly OutlineItem[],
  proposed: readonly OutlineItem[],
): { units: OutlineItem[]; source: 'RULES' | 'AI' } {
  const ai = tidyTitles(proposed);
  if (!leafCount(ruled)) return { units: ai, source: 'AI' };
  if (!leafCount(ai)) return { units: [...ruled], source: 'RULES' };
  const [ruledMinutes, aiMinutes] = [knownMinutes(ruled), knownMinutes(ai)];
  const rulesWin =
    ruledMinutes !== aiMinutes ? ruledMinutes > aiMinutes : ruledMinutes > 0 ? true : leafCount(ruled) > leafCount(ai);
  return rulesWin ? { units: [...ruled], source: 'RULES' } : { units: ai, source: 'AI' };
}

/**
 * AI가 "이 페이지에는 목차가 없다"고 답했을 때 규칙으로 뽑은 것을 남길지.
 *
 * 규칙은 "목차"나 "Contents"라는 말 뒤를 뽑을 뿐이라, 백과사전 문서의 자체 차례 같은 것을
 * 강의 목차로 착각한다. AI가 없다고 분명히 말했는데 규칙의 결과가 몇 줄뿐이고 길이도
 * 없다면 그것은 착각일 가능성이 높다. 길이가 하나라도 있거나 챕터가 넉넉하면 남긴다.
 * AI가 실패한 경우(답을 못 한 것)와는 다르다. 그때는 규칙의 결과를 그대로 쓴다.
 */
export function trustRulesDespiteNotFound(ruled: readonly OutlineItem[]): boolean {
  return knownMinutes(ruled) > 0 || leafCount(ruled) >= 8;
}
