/**
 * 챕터형 자료의 목차를 만드는 두 가지 길.
 *
 * 1. 이름과 개수로 한 번에 만든다. "Unit" × 115. 교재는 대개 이것으로 충분하다.
 * 2. 강의 소개 페이지의 커리큘럼을 복사해 붙인 글에서 뽑는다.
 *
 * 등록이 귀찮으면 아무도 쓰지 않는다. 40강을 손으로 치게 하지 않는 것이 목적이다.
 * 뽑은 결과는 언제나 사용자가 확인하고 고친 뒤에 저장한다.
 */

export interface OutlineItem {
  title: string;
  /** 분. 길이를 모르면 없다. 없는 챕터는 계획의 기본 시간을 쓴다. */
  minutes?: number;
  /** 묶음 제목(강의의 섹션, 교재의 Part). 일정에 들어가지 않는다. */
  section?: true;
}

export const MAX_UNITS = 2000;
const MAX_TITLE = 500;

/** "Unit" × 115 → Unit 1 … Unit 115 */
export function generateOutline(label: string, count: number, startAt = 1): OutlineItem[] {
  const name = label.replace(/\s+/g, ' ').trim();
  if (!name || !Number.isInteger(count) || count < 1 || count > MAX_UNITS) return [];
  if (!Number.isInteger(startAt) || startAt < 0 || startAt > 100_000) return [];
  // "강", "회"처럼 뒤에 붙는 말은 숫자 뒤에 붙인다. 1강, 2강.
  const suffix = /^[가-힣]{1,2}$/.test(name);
  return Array.from({ length: count }, (_, index) => ({
    title: suffix ? `${startAt + index}${name}` : `${name} ${startAt + index}`,
  }));
}

/**
 * 글 끝이나 한 줄 전체에 있는 길이를 분으로 읽는다. 읽지 못하면 null.
 * "20:15", "1:02:03", "12분", "1시간 20분", "(7시간 16분)".
 * 분 미만은 올린다. 2분 36초는 3분이다. 0분짜리 일정은 없다.
 */
export function parseDuration(text: string): number | null {
  const value = text.trim().replace(/^[∙·(\[\s]+|[)\]\s]+$/g, '');
  const clock = /^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d)$/.exec(value);
  if (clock) {
    const seconds = Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    return clampMinutes(Math.ceil(seconds / 60));
  }
  const words = /^(?:(\d{1,3})\s*시간)?\s*(?:(\d{1,4})\s*분)?\s*(?:(\d{1,2})\s*초)?$/.exec(value);
  if (words && (words[1] || words[2] || words[3])) {
    const seconds = Number(words[1] ?? 0) * 3600 + Number(words[2] ?? 0) * 60 + Number(words[3] ?? 0);
    return clampMinutes(Math.ceil(seconds / 60));
  }
  return null;
}
const clampMinutes = (minutes: number) => (minutes < 1 ? 1 : minutes > 1440 ? 1440 : minutes);

/** 복사하면 따라오는 말들. 챕터 제목이 아니다. */
const NOISE = /^(커리큘럼|curriculum|목차|미리보기|무료|잠금|재생|preview|free|new|모두 펼치기|모두 접기|해당 강의에서 제공:?|수업자료|미션|퀴즈|전체)$/i;
/**
 * "41개", "2개" 같은 개수 줄. 합계 시간이 같은 줄에 붙어 오기도 한다("7개 ∙ (1시간 14분)").
 * 화면에서는 한 줄이고, 글 사이에 빈 주석을 넣는 페이지에서는 글로 뽑아도 한 줄이다.
 */
const COUNT_LINE = /^\d{1,4}\s*개(?:\s*[∙·•|\-]?\s*(.+))?$/;
const SECTION_LINE = /^(?:섹션|section|part|파트|chapter|챕터)\s*\d{1,3}\s*[.:)\-]?\s*(.*)$/i;
/** "1.", "12)" 처럼 번호만 있는 줄. 제목은 다음 줄에 온다. */
const BARE_NUMBER = /^(\d{1,4})\s*[.)]$/;
/** 줄 끝에 붙은 길이. "OT 12:30", "제목 (12분)", "제목 - 1:02:03" */
const TRAILING_TIME = /^(.*?)[\s\-–—|·∙(\[]+((?:\d{1,2}:)?\d{1,3}:[0-5]\d|(?:\d{1,3}\s*시간\s*)?\d{1,4}\s*분(?:\s*\d{1,2}\s*초)?)[)\]]?$/;

/**
 * 붙여 넣은 글에서 목차를 뽑는다.
 *
 * 두 모양을 다룬다. 한 줄에 하나씩 적힌 목록("1강 OT 12:30")과, 강의 사이트를
 * 복사했을 때처럼 번호, 제목, 길이가 줄마다 흩어진 모양이다. 길이만 있는 줄은 바로
 * 앞 챕터의 길이로 본다. 섹션 줄 바로 뒤의 개수와 합계 시간은 버린다.
 */
export function parseOutline(text: string): OutlineItem[] {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const items: OutlineItem[] = [];
  // 섹션 줄 뒤에 오는 합계 시간. 섹션이 접힌 채 복사됐을 때만 쓴다.
  const sectionTotals = new Map<OutlineItem, number>();
  let afterSection = false;
  let expectTitle = false;

  for (const line of lines) {
    if (NOISE.test(line)) continue;
    const counted = COUNT_LINE.exec(line);
    if (counted) {
      const total = counted[1] ? parseDuration(counted[1]) : null;
      // "3개 국어로 배우는 회화"처럼 개수로 시작하는 제목은 개수 줄이 아니다.
      if (!counted[1] || total !== null) {
        const last = items.at(-1);
        if (total !== null && afterSection && last?.section) sectionTotals.set(last, total);
        continue;
      }
    }

    const alone = parseDuration(line);
    if (alone !== null) {
      // 섹션 바로 뒤의 시간은 섹션의 합계다. 챕터의 길이가 아니다.
      const last = items.at(-1);
      if (afterSection && last?.section) sectionTotals.set(last, alone);
      else if (last && !last.section && last.minutes === undefined) last.minutes = alone;
      continue;
    }

    const section = SECTION_LINE.exec(line);
    if (section) {
      items.push({ title: clip(section[1] || line), section: true });
      afterSection = true;
      expectTitle = false;
      continue;
    }

    if (BARE_NUMBER.test(line)) {
      expectTitle = true;
      afterSection = false;
      continue;
    }

    afterSection = false;
    const timed = TRAILING_TIME.exec(line);
    const minutes = timed ? parseDuration(timed[2]!) : null;
    const rawTitle = timed && minutes !== null ? timed[1]! : line;
    // 번호가 앞줄에 따로 있었다면 제목은 그대로 쓴다. 아니면 "12. 제목"의 번호를 뗀다.
    const title = clip(expectTitle ? rawTitle : rawTitle.replace(/^\d{1,4}\s*[.)]\s+/, ''));
    expectTitle = false;
    if (!title) continue;
    items.push(minutes !== null ? { title, minutes } : { title });
    if (items.length >= MAX_UNITS + 500) break;
  }

  // 챕터가 하나도 딸리지 않은 섹션. 사이트에서 섹션을 펼치지 않고 복사하면 이렇게 온다.
  // 합계 시간이 있으면 섹션 자체를 챕터 하나로 삼는다. 없으면 버린다.
  const result: OutlineItem[] = [];
  items.forEach((item, index) => {
    const next = items[index + 1];
    if (!item.section || (next && !next.section)) result.push(item);
    else {
      const total = sectionTotals.get(item);
      if (total !== undefined) result.push({ title: item.title, minutes: total });
    }
  });
  return result;
}

const clip = (title: string) => title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

export interface OutlineSummary {
  units: number;
  sections: number;
  /** 길이를 아는 챕터의 합(분) */
  knownMinutes: number;
  /** 길이를 모르는 챕터 수 */
  untimed: number;
}

export function summarizeOutline(items: readonly OutlineItem[]): OutlineSummary {
  let units = 0;
  let sections = 0;
  let knownMinutes = 0;
  let untimed = 0;
  for (const item of items) {
    if (item.section) sections++;
    else {
      units++;
      if (item.minutes === undefined) untimed++;
      else knownMinutes += item.minutes;
    }
  }
  return { units, sections, knownMinutes, untimed };
}

/**
 * 길이를 모르는 챕터에 쓸 기본 시간을 권한다. 아는 챕터의 중앙값이다.
 * 평균은 두 시간짜리 라이브 하나에 끌려간다. 아는 것이 없으면 null이다.
 */
export function suggestDefaultMinutes(items: readonly OutlineItem[]): number | null {
  const known = items.filter((item) => !item.section && item.minutes !== undefined).map((item) => item.minutes!);
  if (!known.length) return null;
  known.sort((a, b) => a - b);
  const middle = Math.floor(known.length / 2);
  return known.length % 2 ? known[middle]! : Math.round((known[middle - 1]! + known[middle]!) / 2);
}
