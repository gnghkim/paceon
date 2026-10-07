import { z } from 'zod';
import type { Tables } from '@paceon/shared';

/** 텔레그램 아이디(@ 없이). 이 모양이 아니면 링크를 만들지 않는다. */
const BOT_USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;
const LINK_CODE = /^[A-Z0-9]{8}$/;

export const validBotUsername = (value: string | null | undefined): string | null =>
  value && BOT_USERNAME.test(value) ? value : null;

/** 설정에서 누르면 텔레그램이 봇에 "/start 코드"를 보내 바로 연결된다. */
export function deepLink(botUsername: string | null | undefined, code: string): string | null {
  const bot = validBotUsername(botUsername);
  return bot && LINK_CODE.test(code) ? `https://t.me/${bot}?start=${code}` : null;
}

/** 그때 쓴 문장에서 틀린 부분을 찾아 표시한다. 대소문자는 가리지 않고 처음 한 곳만. */
export function markMistake(sentence: string, wrong: string): { text: string; marked: boolean }[] {
  const at = wrong ? sentence.toLowerCase().indexOf(wrong.toLowerCase()) : -1;
  if (at < 0) return [{ text: sentence, marked: false }];
  return [
    { text: sentence.slice(0, at), marked: false },
    { text: sentence.slice(at, at + wrong.length), marked: true },
    { text: sentence.slice(at + wrong.length), marked: false },
  ].filter(part => part.text.length > 0);
}

/** 같은 실수는 한 장이다. DB의 유일 키와 같은 방식으로 맞춘다. */
export const cardKey = (wrong: string, correct: string) =>
  `${wrong.trim().toLowerCase()}\u0000${correct.trim().toLowerCase()}`;

export interface CardStatus {
  dueOn: string;
  reviewCount: number;
  occurrences: number;
}

export interface TelegramTurnView {
  id: string;
  createdAt: string;
  /** 사용자 시간대의 날짜. 날짜별로 묶어 보여 준다. */
  date: string;
  inputKind: 'TEXT' | 'VOICE';
  learnerText: string;
  /** 튜터의 대답. 피드백은 mistakes로 따로 보여 준다. */
  reply: string;
  mistakes: { wrong: string; correct: string; rule: string; card: CardStatus | null }[];
  naturalVersion: string;
  tip: string;
  rewrite: { correct: boolean | null } | null;
}

type TurnRow = Pick<
  Tables<'telegram_turns'>,
  'id' | 'input_kind' | 'learner_text' | 'reply_text' | 'tutor_turn' | 'rewrite_attempt' | 'rewrite_correct' | 'created_at'
>;

// 저장된 튜터 응답은 Worker가 검증한 것이지만, 화면은 모양이 어긋나도 학습자 문장은 보여 준다.
const storedTurn = z.object({
  reply: z.string().catch(''),
  mistakes: z
    .array(z.object({ wrong: z.string(), correct: z.string(), rule: z.string().catch('') }))
    .catch([]),
  natural_version: z.string().catch(''),
  tip: z.string().catch(''),
});

const conversationOnly = (text: string) => text.split('[Feedback]')[0]!.trim();

export function shapeTurn(row: TurnRow, cards: ReadonlyMap<string, CardStatus>, timezone: string): TelegramTurnView {
  const parsed = storedTurn.safeParse(row.tutor_turn ?? {});
  const turn = parsed.success ? parsed.data : { reply: '', mistakes: [], natural_version: '', tip: '' };
  return {
    id: row.id,
    createdAt: row.created_at,
    date: new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(row.created_at)),
    inputKind: row.input_kind === 'VOICE' ? 'VOICE' : 'TEXT',
    learnerText: row.learner_text,
    reply: turn.reply || conversationOnly(row.reply_text),
    mistakes: turn.mistakes.map(m => ({
      wrong: m.wrong,
      correct: m.correct,
      rule: m.rule,
      card: cards.get(cardKey(m.wrong, m.correct)) ?? null,
    })),
    naturalVersion: turn.natural_version,
    tip: turn.tip,
    rewrite: row.rewrite_attempt ? { correct: row.rewrite_correct } : null,
  };
}
