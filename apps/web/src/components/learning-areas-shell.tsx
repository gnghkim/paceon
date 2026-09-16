'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-provider';
import { LAST_AREA_KEY, areaForKind, learningAreas, resumeWorkspaces, workspaceHref } from './learning-areas';
import { learningDuration, type LearningList } from './learning-types';

export function LearningAreasShell({ children }: { children: ReactNode }) {
  const { apiFetch } = useAuth();
  const pathname = usePathname();
  const [recent, setRecent] = useState<LearningList | null>(null);
  useEffect(() => {
    const area = learningAreas.find((item) => pathname === `/learn/${item.slug}`);
    if (!area) return;
    try { localStorage.setItem(LAST_AREA_KEY, area.slug); } catch { /* Tab memory is a convenience only. */ }
  }, [pathname]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void apiFetch('/api/learning/workspaces', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: LearningList | null) => { if (!cancelled) setRecent(body); })
        .catch(() => { /* Resume is optional; each tab reports its own load errors. */ });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [apiFetch]);
  const resume = resumeWorkspaces(recent);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <p className="mb-2 text-sm font-medium text-primary">나만의 작은 영어 연습</p>
        <h1 className="text-3xl font-semibold">영어학습</h1>
        <p className="mt-3 text-muted-foreground">한 문장부터, 내 속도로 이어가요.</p>
      </header>
      {resume.length > 0 && (
        <section aria-labelledby="resume-title" className="space-y-3">
          <h2 id="resume-title" className="font-semibold">이어서 공부하기</h2>
          {resume.map((w) => {
            const video = recent?.videos?.find((v) => v.workspace_id === w.id);
            return (
              <Link key={w.id} href={workspaceHref(w)} className="flex min-h-20 items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary">{areaForKind(w.kind).label}</p>
                  <h3 className="mt-1 break-words font-medium">{w.title}</h3>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {video ? `YouTube · ${learningDuration(video.position_seconds)}에서 이어 보기` : w.draft || w.prompt || '이전 기록 이어 보기'}
                  </p>
                </div>
                <ArrowRight className="shrink-0 text-primary" aria-hidden="true" />
              </Link>
            );
          })}
        </section>
      )}
      <ReviewLink />
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
      {children}
    </div>
  );
}

/** 오늘 복습할 표현이 있을 때만 보여 준다. 없으면 자리를 차지하지 않는다. */
function ReviewLink() {
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
        .catch(() => { /* 복습 안내는 보조 정보다. */ });
    }, 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiFetch]);
  if (due === 0) return null;
  return (
    <Link href="/learn/review" className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 hover:border-primary">
      <span className="text-sm">
        오늘의 복습 <span className="font-medium text-primary">{due}개</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-primary" aria-hidden="true" />
    </Link>
  );
}
