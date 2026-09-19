'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Check, Trash2 } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { formatDate } from '@/lib/planning';
import {
  DAILY_REVIEW_SIZE,
  reviewPrompt,
  reviewStatus,
  reviewStatusLabel,
  type ExpressionCard,
  type ReviewGrade,
} from '@/lib/expression-review';

interface Payload {
  today: string;
  saved: number;
  due: number;
  cards: ExpressionCard[];
}

const grades: readonly (readonly [ReviewGrade, string])[] = [
  ['HARD', '어려웠어요'],
  ['OK', '보통이에요'],
  ['EASY', '쉬웠어요'],
];

/**
 * 오늘의 복습. 뜻을 먼저 보여 주지 않고 표현만 보여 준 뒤 떠올리게 한다.
 * 밀린 개수를 세어 보여 주지 않는다. 오늘 할 몫만 끝내면 된다.
 */
export function ExpressionReview() {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [nextDue, setNextDue] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/learning/expressions', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '표현을 불러오지 못했어요.');
      setData(body as Payload);
      setIndex(0);
      setRevealed(false);
      setError('');
      return body as Payload;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    }
  }, [apiFetch]);

  // Check the remaining queue after the current batch; skipped cards are still due.
  const [summary, setSummary] = useState<{ saved: number; due: number } | null>(null);
  useEffect(() => {
    if (!data || data.cards.length === 0 || index < data.cards.length) return;
    const controller = new AbortController();
    void apiFetch('/api/learning/expressions', { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('남은 복습을 불러오지 못했어요.');
        return response.json();
      })
      .then((body: Payload) => {
        if (!controller.signal.aborted) setSummary(body);
      })
      .catch(() => { if (!controller.signal.aborted) setError('남은 복습을 불러오지 못했어요. 다시 불러와 주세요.'); });
    return () => controller.abort();
  }, [apiFetch, data, index]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const card = data?.cards[index];
  const status = reviewStatus(data?.cards.length === 0 ? data : summary, done, Boolean(error));
  const more = summary?.due ?? 0;
  const saved = summary?.saved ?? data?.saved ?? 0;

  async function grade(value: ReviewGrade) {
    if (!card || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/learning/expressions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: card.id, grade: value }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '결과를 저장하지 못했어요.');
      setNextDue(body.nextDueOn ?? null);
      setDone((value) => value + 1);
      setRevealed(false);
      setIndex((value) => value + 1);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!card || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/learning/expressions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: card.id }),
      });
      if (!response.ok) throw new Error('Delete failed');
      setRevealed(false);
      setIndex((value) => value + 1);
    } catch {
      setError('지우지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <Skeleton className="h-60 w-full" />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href="/today"
          className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          오늘로
        </Link>
        <h1 className="text-2xl font-semibold">오늘의 복습</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          읽은 내용과 영어 단어·표현을 간격을 두고 다시 꺼내 봐요. 하루 {DAILY_REVIEW_SIZE}개면 충분해요.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
          {error}
          {!card && <Button variant="outline" className="mt-3" onClick={() => { setSummary(null); void load(); }}>다시 불러오기</Button>}
        </div>
      )}

      {data && !card ? (
        <section className="rounded-xl border border-border bg-card px-6 py-12 text-center">
          {status === 'complete' && <Check size={28} className="mx-auto mb-4 text-success" aria-hidden="true" />}
          <h2 className="font-semibold">
            {status === 'ready' ? '아직 복습할 내용이 남아 있어요' : reviewStatusLabel[status]}
          </h2>
          <p className="mx-auto mt-2 mb-6 max-w-sm text-sm leading-6 text-muted-foreground">
            {status === 'complete'
              ? nextDue
                ? `다음 복습은 ${formatDate(nextDue)}부터예요.`
                : '다음 예정일에 다시 꺼내 볼게요.'
              : status === 'loading' || status === 'error' ? '' : saved > 0
                ? '저장한 것은 예정일이 되면 여기 나와요.'
                : '단어장에 단어를 넣거나, 책을 읽은 뒤 기억나는 것을 적어 두면 여기서 다시 물어봐요.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {more > 0 && (
              <Button
                type="button"
                onClick={() => {
                  setDone(0);
                  setSummary(null);
                  void load();
                }}
              >
                {more}개 더 하기
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href="/learn/words">단어장 보기</Link>
            </Button>
          </div>
        </section>
      ) : (
        card && (
          <section className="space-y-5 rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">
              {index + 1} / {data!.cards.length}
            </p>
            {(
              <p className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                <BookOpen size={13} aria-hidden="true" />
                {card.kind === 'RECALL' ? '독서 회상' : '영어 단어·표현'}
              </p>
            )}
            <p className="text-xl font-semibold break-words">{card.phrase}</p>
            {!revealed ? (
              <>
                <p className="text-sm text-muted-foreground">{reviewPrompt(card)}</p>
                <Button type="button" onClick={() => setRevealed(true)}>
                  {card.kind === 'RECALL' ? '내가 적은 것 보기' : '뜻 확인하기'}
                </Button>
              </>
            ) : (
              <>
                <div className="space-y-2 rounded-lg bg-accent/50 p-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{card.meaning}</p>
                  {card.kind === 'RECALL' && (
                    // 꺼낸 뒤에는 맞는지 확인해야 한다. 틀린 기억을 되풀이하면 굳는다.
                    // 여기서 답은 그때 적은 것뿐이라, 진짜 답인 책으로 가는 길을 함께 둔다.
                    <p className="text-xs leading-5 text-muted-foreground">
                      떠올린 것과 다르거나 빠진 것이 있으면 책의 그 범위를 펼쳐 확인해 보세요.
                      {card.resource_id && (
                        <>
                          {' '}
                          <Link href={`/resources/${card.resource_id}`} className="text-primary underline">
                            책 보기
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  {card.examples.map((example) => (
                    <p key={example} className="text-sm leading-6 text-muted-foreground">
                      {example}
                    </p>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {grades.map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={value === 'OK' ? 'secondary' : 'outline'}
                      disabled={busy}
                      onClick={() => void grade(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  어려웠으면 내일 다시, 쉬웠으면 더 긴 간격으로 물어봐요.
                </p>
              </>
            )}
            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setRevealed(false);
                  setIndex((value) => value + 1);
                }}
              >
                건너뛰기
              </Button>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
                <Trash2 size={15} aria-hidden="true" />
                복습함에서 빼기
              </Button>
            </div>
          </section>
        )
      )}

      {data && saved > 0 && (
        <p className="text-sm text-muted-foreground">복습함에 {saved}개 저장돼 있어요.</p>
      )}
    </div>
  );
}
