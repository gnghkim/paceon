'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LAST_AREA_KEY, learningAreas } from './learning-areas';

export function LearningAreasShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  useEffect(() => {
    const area = learningAreas.find((item) => pathname === `/learn/${item.slug}`);
    if (!area) return;
    try { localStorage.setItem(LAST_AREA_KEY, area.slug); } catch { /* Tab memory is a convenience only. */ }
  }, [pathname]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-primary">나만의 작은 영어 연습</p>
        <h1 className="text-3xl font-semibold">영어 학습</h1>
        <p className="mt-3 text-muted-foreground">한 문장부터, 내 속도로 이어가요.</p>
      </header>
      <nav aria-label="학습 영역" className="flex gap-1 overflow-x-auto border-b border-border">
        {learningAreas.map((area) => {
          const current = pathname === `/learn/${area.slug}`;
          return (
            <Link key={area.slug} href={`/learn/${area.slug}`} aria-current={current ? 'page' : undefined}
              className={cn('min-h-11 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium', current ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {area.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href="/learn/words" className="inline-flex min-h-11 items-center gap-2 text-primary">단어장 <ArrowRight size={15} aria-hidden="true" /></Link>
        <Link href="/review" className="inline-flex min-h-11 items-center gap-2 text-primary">공통 복습 <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
      {children}
    </div>
  );
}
