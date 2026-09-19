'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { useAuth } from './auth-provider';

/**
 * 오늘 다시 꺼내 볼 것. 단어와 표현, 읽은 책에서 떠올린 것을 함께 묻는다.
 *
 * 영어학습 카드 안에 있던 것을 꺼냈다. 복습은 과목에 속하지 않는다. 책만 읽는
 * 사람에게도 나와야 하고, 영어 카드 안에 있으면 책의 회상이 거기 있을 이유가 없다.
 * 없으면 자리를 차지하지 않고, 밀린 개수를 세지 않는다.
 */
export function TodayReview({ refreshKey }: { refreshKey?: unknown }) {
  const { apiFetch } = useAuth();
  const [due, setDue] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void apiFetch('/api/learning/expressions', { signal: controller.signal, cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { due: number } | null) => {
          if (!controller.signal.aborted && body) setDue(body.due);
        })
        // 보조 정보다. 못 읽어도 오늘 화면의 나머지는 그대로 쓸 수 있다.
        .catch(() => {});
    }, 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [apiFetch, refreshKey]);

  if (due <= 0) return null;
  return (
    <Link
      href="/learn/review"
      className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-5 py-3 hover:border-primary"
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <RotateCcw size={18} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            오늘의 복습 <span className="text-primary">{due}개</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            읽은 것과 담아 둔 단어를 다시 꺼내 봐요
          </span>
        </span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-primary" aria-hidden="true" />
    </Link>
  );
}
