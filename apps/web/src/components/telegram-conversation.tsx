'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Mic } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import type { TelegramTurnView } from '@/lib/telegram-tutor';

type Page = { linked: boolean; timezone: string; turns: TelegramTurnView[]; nextBefore: string | null };

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
const timeLabel = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(iso));

/** 텔레그램 튜터와 나눈 대화. 읽기 전용이다. 날짜별로 묶어 최근 것부터 보여 준다. */
export function TelegramConversation() {
  const { apiFetch } = useAuth();
  const [turns, setTurns] = useState<TelegramTurnView[]>([]);
  const [meta, setMeta] = useState<Omit<Page, 'turns'> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (before: string | null) => {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/telegram/turns${before ? `?before=${encodeURIComponent(before)}` : ''}`, { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '대화를 불러오지 못했어요.');
      const page = body as Page;
      setTurns(current => (before ? [...current, ...page.turns] : page.turns));
      setMeta({ linked: page.linked, timezone: page.timezone, nextBefore: page.nextBefore });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '대화를 불러오지 못했어요.');
    } finally {
      setBusy(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    const timer = setTimeout(() => void load(null), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const days: { date: string; turns: TelegramTurnView[] }[] = [];
  for (const turn of turns) {
    const last = days.at(-1);
    if (last && last.date === turn.date) last.turns.push(turn);
    else days.push({ date: turn.date, turns: [turn] });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" className="-ml-3">
        <Link href="/learn"><ArrowLeft className="size-4" />영어 학습</Link>
      </Button>
      <header>
        <h1 className="text-3xl font-semibold">텔레그램 대화</h1>
        <p className="mt-3 text-muted-foreground">
          텔레그램 튜터와 나눈 대화예요. 고친 실수는 복습 카드가 되어 <Link href="/review" className="text-primary underline">공통 복습</Link>에 나와요.
        </p>
      </header>

      {error && <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">{error}</p>}
      {!meta && !error && <Skeleton className="h-40 w-full" />}

      {meta && turns.length === 0 && (
        <section className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          <h2 className="font-semibold">아직 나눈 대화가 없어요</h2>
          <p className="mx-auto mt-2 mb-6 max-w-sm text-sm leading-6 text-muted-foreground">
            {meta.linked
              ? '텔레그램에서 튜터에게 영어로 말을 걸어 보세요.'
              : '설정에서 텔레그램을 연결하면 튜터와 나눈 대화가 여기 쌓여요.'}
          </p>
          {!meta.linked && (
            <Button asChild><Link href="/settings#telegram">텔레그램 연결하기</Link></Button>
          )}
        </section>
      )}

      {meta && days.map(group => (
        <section key={group.date} aria-label={dateLabel(group.date)} className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">{dateLabel(group.date)}</h2>
          {group.turns.map(turn => <Turn key={turn.id} turn={turn} timezone={meta.timezone} />)}
        </section>
      ))}

      {meta?.nextBefore && (
        <Button variant="outline" disabled={busy} onClick={() => void load(meta.nextBefore)}>
          {busy ? '불러오는 중…' : '이전 대화 더 보기'}
        </Button>
      )}
    </div>
  );
}

function Turn({ turn, timezone }: { turn: TelegramTurnView; timezone: string }) {
  return (
    <article className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="break-words font-medium">
          {turn.inputKind === 'VOICE' && <Mic size={14} className="mr-1 inline align-[-2px] text-muted-foreground" aria-label="음성" />}
          {turn.learnerText}
        </p>
        <time dateTime={turn.createdAt} className="shrink-0 text-xs text-muted-foreground">{timeLabel(turn.createdAt, timezone)}</time>
      </div>
      {turn.rewrite && (
        <p className={turn.rewrite.correct ? 'text-sm text-success' : 'text-sm text-muted-foreground'}>
          {turn.rewrite.correct ? '고쳐 쓰기 성공' : '고쳐 쓰기 · 다시 해 볼 부분이 있었어요'}
        </p>
      )}
      {turn.mistakes.length > 0 && (
        <ul className="space-y-2 rounded-lg bg-accent/50 p-3 text-sm">
          {turn.mistakes.map(mistake => (
            <li key={`${mistake.wrong}→${mistake.correct}`} className="space-y-0.5">
              <p className="break-words">
                <span className="line-through decoration-danger/60">{mistake.wrong}</span> → <span className="font-medium">{mistake.correct}</span>
                {mistake.rule && <span className="text-muted-foreground"> · {mistake.rule}</span>}
              </p>
              {mistake.card && (
                <p className="text-xs text-muted-foreground">
                  복습 카드 · 다음 복습 {dateLabel(mistake.card.dueOn)}
                  {mistake.card.reviewCount > 0 ? ` · ${mistake.card.reviewCount}번 복습` : ''}
                  {mistake.card.occurrences > 1 ? ` · 같은 실수 ${mistake.card.occurrences}번` : ''}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {turn.naturalVersion && (
        <p className="break-words text-sm"><span className="text-muted-foreground">자연스러운 문장 · </span>{turn.naturalVersion}</p>
      )}
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{turn.reply}</p>
      {turn.tip && <p className="text-sm text-muted-foreground">💡 {turn.tip}</p>}
    </article>
  );
}
