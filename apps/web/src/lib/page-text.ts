/**
 * 받은 HTML에서 사람이 보는 글을 뽑는다. 목차를 찾는 AI에게 넘길 재료다.
 *
 * DOM을 만들지 않는다. 남의 HTML을 해석기로 돌리는 것은 그 자체로 공격면이고, 여기서
 * 필요한 것은 줄 단위의 글뿐이다. 스크립트와 스타일을 통째로 버리고 태그를 줄바꿈으로
 * 바꾼다. 결과는 신뢰할 수 없는 자료로 다룬다. 명령으로 읽지 않는다.
 */

export interface PageText {
  title: string;
  description: string;
  /** 줄바꿈으로 나뉜 본문. 목차가 있을 만한 곳을 중심으로 잘라 둔 것이다. */
  text: string;
  /** 자르기 전 본문의 글자 수. 글이 거의 없으면 화면이 스크립트로 그려지는 페이지다. */
  fullLength: number;
}

export const MAX_TEXT = 40_000;

const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', hellip: '…', ndash: '–', mdash: '—' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1]!.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      // 제어 문자와 범위를 벗어난 값은 버린다.
      if (!Number.isFinite(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return ' ';
      return String.fromCodePoint(code);
    }
    return named[body.toLowerCase()] ?? whole;
  });
}

/** 받은 바이트를 글자로. 선언된 문자 집합을 따르고, 모르면 UTF-8로 본다. 국내 서점에는 EUC-KR이 남아 있다. */
export function decodeBody(body: Uint8Array, contentType: string): string {
  const head = new TextDecoder('latin1').decode(body.slice(0, 2048));
  const declared =
    /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8';
  const label = /^(euc-kr|ks_c_5601-1987|cp949|x-windows-949)$/i.test(declared) ? 'euc-kr' : declared.toLowerCase();
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

const meta = (html: string, key: string) => {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = pattern.exec(html)?.[0];
  const content = tag ? /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag) : null;
  return content ? decodeEntities(content[1] ?? content[2] ?? '').replace(/\s+/g, ' ').trim() : '';
};

const OUTLINE_MARK = /(커리큘럼|목차|차례|강의\s*구성|수업\s*구성|curriculum|table of contents|contents|syllabus|course content)/i;

/**
 * 목차가 있을 만한 곳을 중심으로 자른다. 긴 페이지는 앞부분이 소개 글과 후기로 가득하다.
 * 표시어가 여러 번 나오면 마지막 것을 쓴다. 앞의 것은 대개 페이지 안 메뉴의 링크다.
 */
export function focusOnOutline(lines: readonly string[], max = MAX_TEXT): string {
  const whole = lines.join('\n');
  if (whole.length <= max) return whole;
  let mark = -1;
  lines.forEach((line, index) => {
    if (line.length <= 40 && OUTLINE_MARK.test(line)) mark = index;
  });
  if (mark < 0) return whole.slice(0, max);
  const before = lines.slice(Math.max(0, mark - 15), mark).join('\n');
  return `${before}\n${lines.slice(mark).join('\n')}`.slice(0, max);
}

const OUTLINE_END = /^(수강평|수강 후기|리뷰|후기|강의 게시일|마지막 업데이트일|자주 묻는 질문|지식공유자|강사 소개|저자 소개|출판사 서평|책 속으로|reviews?|faq|about the (instructor|author))/i;

/**
 * 페이지의 글에서 목차 부분만 잘라 낸다. 규칙으로 목차를 뽑을 때 쓴다.
 *
 * 사용자가 골라 붙여 넣은 글과 달리 페이지 전체에는 소개 문단과 후기가 섞여 있다.
 * 그대로 뽑으면 소개 문단이 챕터가 된다. 마지막 목차 표시어 다음부터, 후기나 저자 소개가
 * 시작되기 전까지만 돌려준다. 표시어가 없으면 빈 글이다. 어디가 목차인지 모르는 채로
 * 추측해 뽑느니 뽑지 않는다.
 */
export function outlineRegion(text: string): string {
  const lines = text.split('\n');
  let mark = -1;
  lines.forEach((line, index) => {
    if (line.length <= 40 && OUTLINE_MARK.test(line)) mark = index;
  });
  if (mark < 0) return '';
  const rest = lines.slice(mark + 1);
  const end = rest.findIndex((line) => line.length <= 40 && OUTLINE_END.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

export function extractPage(html: string): PageText {
  const title =
    meta(html, 'og:title') ||
    decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const description = meta(html, 'og:description') || meta(html, 'description');
  const visible = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '\n');
  const lines = decodeEntities(visible)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return {
    title: title.slice(0, 300),
    description: description.slice(0, 1000),
    text: focusOnOutline(lines),
    fullLength: lines.join('\n').length,
  };
}
