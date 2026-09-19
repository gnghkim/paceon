'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { reviewStatus, reviewStatusLabel } from '@/lib/expression-review';

/** Stable shared review entry, including empty and failed loads. */
export function TodayReview({ refreshKey }: { refreshKey?: unknown }) {
  const { apiFetch } = useAuth();
  const [summary, setSummary] = useState<{ saved: number; due: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setFailed(false);
      setSummary(null);
      void apiFetch('/api/learning/expressions', { signal: controller.signal, cache: 'no-store' })
        .then(async response => {
          if (!response.ok) throw new Error('Review request failed');
          return response.json();
        })
        .then((body: { saved: number; due: number }) => {
          if (!controller.signal.aborted) setSummary(body);
        })
        .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    }, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiFetch, refreshKey, attempt]);
  const status = reviewStatus(summary, 0, failed);
  return (
    <div className="rounded-xl border border-border bg-card">
      <Link href="/review" className="flex min-h-14 items-center justify-between gap-3 px-5 py-3 hover:text-primary">
        <span className="flex min-w-0 items-center gap-2.5">
          <RotateCcw size={18} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">오늘의 복습 {status === 'ready' && <span className="text-primary">{summary?.due}개</span>}</span>
            <span className="block text-xs text-muted-foreground" role={failed ? 'alert' : 'status'}>{reviewStatusLabel[status]}</span>
          </span>
        </span>
        <ArrowRight size={16} className="shrink-0 text-primary" aria-hidden="true" />
      </Link>
      {failed && <Button variant="outline" className="mx-5 mb-3" onClick={() => setAttempt(value => value + 1)}>다시 불러오기</Button>}
    </div>
  );
}
