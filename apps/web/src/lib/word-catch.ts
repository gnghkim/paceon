/**
 * 공부하다 만난 단어를 그 자리에서 단어장에 담을 때 쓰는 입력 정리.
 *
 * 듣다가 적는 단어는 문장에서 떼어 온 모양으로 들어온다. 따옴표에 싸여 있거나
 * 쉼표·마침표가 붙어 있거나 사이에 공백이 여러 칸 들어간다. 그대로 저장하면
 * 같은 단어가 서로 다른 항목으로 쌓이고 중복 안내도 걸리지 않는다.
 */

/** 문장에서 떼어 올 때 앞뒤에 따라오는 것들. 단어 안쪽 부호는 건드리지 않는다. */
const LEADING = /^[\s"'“”‘’«»(\[{]+/u;
const TRAILING = /[\s"'“”‘’«»)\]}.,!?;:]+$/u;

export const MAX_PHRASE_LENGTH = 200;

/**
 * 담을 수 있는 모양으로 다듬는다. 담을 것이 없으면 null이다.
 * 사이 공백은 한 칸으로 모은다. "put  off"와 "put off"는 같은 단어다.
 */
export function normalizePhrase(raw: string): string | null {
  const collapsed = raw.replace(/\s+/gu, ' ');
  const trimmed = collapsed.replace(LEADING, '').replace(TRAILING, '');
  if (!trimmed || trimmed.length > MAX_PHRASE_LENGTH) return null;
  return trimmed;
}

export type CatchOutcome = 'SAVED' | 'DUPLICATE' | 'FAILED';

/** 담은 결과를 읽을 문구로. 밀린 개수나 실패 원인을 늘어놓지 않는다. */
export function catchMessage(outcome: CatchOutcome, phrase: string): string {
  if (outcome === 'SAVED') return `${phrase} 담았어요. 뜻은 단어장에서 채워져요.`;
  if (outcome === 'DUPLICATE') return `${phrase}은(는) 이미 단어장에 있어요.`;
  return '담지 못했어요. 잠시 후 다시 시도해 주세요.';
}
