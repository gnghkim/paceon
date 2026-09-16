'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, MessageSquare } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Skeleton } from './ui/skeleton';
import { areaForKind, resumeWorkspaces, workspaceHref } from './learning-areas';
import { learningDuration, type LearningList } from './learning-types';

/**
 * 오늘 화면의 영어학습 카드. 오늘 쌓인 시간, 목표(정했다면), 이어하기 하나를 보여 준다.
 * 목표를 못 채워도 경고하지 않는다. 시간은 통계에서 이미 받아 온 값을 그대로 쓴다.
 */
export function LearningToday({
  minutes,
  goal,
}: {
  minutes: number | null;
  goal: number | null;
}) {
  const { apiFetch } = useAuth();
  const [list, setList] = useState<LearningList | null>(null);
  const [due, setDue] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void apiFetch('/api/learning/workspaces', {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: LearningList | null) => {
          if (!controller.signal.aborted && body) setList(body);
        })
        // 이어하기는 보조 정보다. 실패해도 카드의 나머지는 그대로 쓸 수 있다.
        .catch(() => {});
      void apiFetch('/api/learning/expressions', {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { due: number } | null) => {
          if (!controller.signal.aborted && body) setDue(body.due);
        })
        .catch(() => {});
    }, 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [apiFetch]);
  const resume = resumeWorkspaces(list, 1)[0];
  const video = resume
    ? list?.videos?.find((item) => item.workspace_id === resume.id)
    : undefined;
  const done = goal !== null && minutes !== null && minutes >= goal;
  return (
    <section
      aria-labelledby="learning-today-heading"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="learning-today-heading"
          className="flex items-center gap-2 font-semibold"
        >
          <MessageSquare size={18} className="text-primary" aria-hidden="true" />
          오늘의 영어학습
        </h2>
        {minutes === null ? (
          <Skeleton className="h-5 w-20" />
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 text-sm ${done ? 'font-medium text-success' : 'text-muted-foreground'}`}
          >
            {done && <Check size={14} aria-hidden="true" />}
            {goal === null ? `${minutes}분` : `${minutes} / ${goal}분`}
          </span>
        )}
      </div>
      {goal !== null && minutes !== null && (
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted"
          aria-hidden="true"
        >
          <div
            className={`h-full rounded-full ${done ? 'bg-success' : 'bg-primary'}`}
            style={{ width: `${Math.min(100, Math.round((minutes / goal) * 100))}%` }}
          />
        </div>
      )}
      {resume ? (
        <Link
          href={workspaceHref(resume)}
          className="mt-4 flex min-h-16 items-center justify-between gap-4 rounded-lg bg-accent/60 px-4 py-3 hover:bg-accent"
        >
          <span className="min-w-0">
            <span className="block text-xs font-medium text-primary">
              {areaForKind(resume.kind).label} · 이어서 공부하기
            </span>
            <span className="mt-1 block truncate text-sm font-medium">
              {resume.title}
            </span>
            {video && (
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {learningDuration(video.position_seconds)}에서 이어 보기
              </span>
            )}
          </span>
          <ArrowRight size={16} className="shrink-0 text-primary" aria-hidden="true" />
        </Link>
      ) : (
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          {minutes ? '오늘도 이어서 해 볼까요?' : '한 문장부터 시작해요.'}
        </p>
      )}
      {due > 0 && (
        <Link
          href="/learn/review"
          className="mt-3 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-border px-4 py-2.5 text-sm hover:border-primary"
        >
          <span>
            오늘의 복습 <span className="font-medium text-primary">{due}개</span>
          </span>
          <ArrowRight size={15} className="shrink-0 text-primary" aria-hidden="true" />
        </Link>
      )}
      <Link
        href="/learn"
        className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary"
      >
        영어학습 열기
        <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </section>
  );
}
