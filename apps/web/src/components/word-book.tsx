'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import type { ExpressionCard } from '@/lib/expression-review';

interface Payload {
  today: string;
  saved: number;
  due: number;
  pending: number;
  cards: ExpressionCard[];
}

/**
 * 단어장. 공부하다 만난 단어를 적으면 AI가 뜻과 예문을 채운다.
 * 뜻을 직접 적어 넣으면 AI를 부르지 않는다. 채워진 단어는 복습함으로 이어진다.
 */
export function WordBook() {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [phrase, setPhrase] = useState('');
  const [meaning, setMeaning] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const field = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await apiFetch('/api/learning/expressions?all=true', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '단어장을 불러오지 못했어요.');
      setData(body as Payload);
      return body as Payload;
    } catch (cause) {
      setError((cause as Error).message);
      return null;
    }
  }, [apiFetch]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // 뜻을 기다리는 단어가 있는 동안만 결과를 확인한다.
  useEffect(() => {
    if (!data || data.pending === 0) return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [data, load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    const word = phrase.trim();
    if (!word || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await apiFetch('/api/learning/expressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phrase: word,
          ...(manual && meaning.trim() ? { meaning: meaning.trim() } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? '단어를 넣지 못했어요.');
        return;
      }
      setPhrase('');
      setMeaning('');
      setMessage(
        manual && meaning.trim()
          ? `${word}을(를) 단어장에 넣었어요.`
          : `${word}의 뜻을 찾고 있어요.`,
      );
      field.current?.focus();
      await load();
    } catch {
      setError('연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch('/api/learning/expressions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch {
      setError('지우지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link
          href="/learn"
          className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          영어 학습
        </Link>
        <h1 className="text-2xl font-semibold">단어장</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          공부하다 만난 단어를 적어 두세요. 뜻과 예문은 AI가 채우고, 다음 날부터 복습에
          나와요.
        </p>
      </header>

      <form onSubmit={add} className="space-y-3 rounded-xl border border-border bg-card p-5">
        <label className="block space-y-2 text-sm" htmlFor="new-phrase">
          <span className="font-medium">단어나 표현</span>
          <Input
            id="new-phrase"
            ref={field}
            maxLength={200}
            placeholder="serendipity"
            value={phrase}
            disabled={busy}
            onChange={(event) => setPhrase(event.target.value)}
          />
        </label>
        {manual && (
          <label className="block space-y-2 text-sm" htmlFor="new-meaning">
            <span className="font-medium">뜻</span>
            <Input
              id="new-meaning"
              maxLength={500}
              placeholder="뜻밖의 발견"
              value={meaning}
              disabled={busy}
              onChange={(event) => setMeaning(event.target.value)}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={busy || !phrase.trim()}>
            <Plus size={15} aria-hidden="true" />
            {busy ? '넣는 중…' : '단어장에 넣기'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setManual(!manual)}
          >
            {manual ? 'AI에게 맡기기' : '뜻 직접 쓰기'}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {manual
            ? '적어 넣은 뜻을 그대로 저장해요. AI를 부르지 않아요.'
            : '단어만 넣으면 AI가 한국어 뜻과 짧은 예문 두 개를 채워요. 보통 몇 초 걸려요.'}
        </p>
        {message && (
          <p role="status" className="text-sm text-primary">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>

      {data && data.due > 0 && (
        <Link
          href="/review"
          className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 hover:border-primary"
        >
          <span className="text-sm">
            오늘의 복습 <span className="font-medium text-primary">{data.due}개</span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-primary" aria-hidden="true" />
        </Link>
      )}

      {!data ? (
        <Skeleton className="h-40 w-full" />
      ) : data.cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          아직 넣은 단어가 없어요. 위에 하나 적어 보세요.
        </p>
      ) : (
        <section aria-label="저장한 단어" className="space-y-3">
          <p className="text-sm text-muted-foreground">{data.saved}개 저장돼 있어요.</p>
          {data.cards.map((card) => (
            <article key={card.id} className="space-y-2 rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-semibold break-words">{card.phrase}</h2>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`${card.phrase} 지우기`}
                  onClick={() => void remove(card.id)}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </div>
              {card.lookup === 'PENDING' ? (
                <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />뜻을 찾고
                  있어요
                </p>
              ) : card.lookup === 'FAILED' ? (
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <RotateCcw size={14} aria-hidden="true" />
                  뜻을 찾지 못했어요. 지운 뒤 뜻을 직접 적어 다시 넣어 주세요.
                </p>
              ) : (
                <>
                  <p className="text-sm leading-6">{card.meaning}</p>
                  {card.examples.map((example) => (
                    <p key={example} className="text-sm leading-6 text-muted-foreground">
                      {example}
                    </p>
                  ))}
                </>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
