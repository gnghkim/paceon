'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Check,
  Plus,
  Sunrise,
} from 'lucide-react';
import { addDays } from '@paceon/scheduler';
import {
  useWorkspace,
  WorkspaceLoading,
  WorkspaceError,
} from './workspace-data';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { SessionCard } from './session-card';
import { StudyHeatmap } from './study-heatmap';
import { formatDate } from '@/lib/planning';
import {
  buildHeatmap,
  computeStreak,
  countWeekDays,
  currentWeek,
} from '@/lib/study-heatmap';
import { summarizeDay } from '@/lib/session-state';
import type { WorkspaceData } from '@/lib/workspace-types';
import type { StatisticsData } from '@/lib/statistics';
import type { HeatmapDay } from '@/lib/study-heatmap';
import { cn } from '@/lib/utils';
import { LearningToday } from './learning-today';
import { CatchUpNotice } from './catch-up-notice';
import { WORKSPACE_CHANGED } from '@/lib/quick-record';

export function TodayView() {
  const { data, error, reload } = useWorkspace();
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <WorkspaceLoading />;
  return <TodayContent data={data} />;
}

function TodayContent({ data }: { data: WorkspaceData }) {
  const statistics = useYearStatistics(data.today);
  const sessions = data.sessions.filter(
    (s) => s.study_date === data.today && s.status !== 'SKIPPED',
  );
  const day = summarizeDay(sessions, data.progress, data.today);
  const upcoming = data.sessions
    .filter((s) => s.study_date > data.today && s.status !== 'SKIPPED')
    .slice(0, 3);
  // 멈춘 계획도 계획이다. 일시 정지한 책이 "계획을 기다리는 책"으로 보이면 안 된다.
  const withoutPlan = data.resources.filter(
    (r) =>
      r.status === 'ACTIVE' &&
      !data.plans.some(
        (p) =>
          p.resource_id === r.id &&
          (p.status === 'ACTIVE' || p.status === 'PAUSED'),
      ),
  );
  return (
    <div className="space-y-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {formatDate(data.today, true)}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">오늘의 학습</h1>
          <p className="mt-3 text-muted-foreground">
            작은 진도 하나, 나의 속도로 이어가요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/calendar">
              <CalendarDays size={16} aria-hidden="true" />
              캘린더
            </Link>
          </Button>
          {!data.resources.length && (
            <Button asChild>
              <Link href="/resources/new">
                <Plus size={16} />책 추가
              </Link>
            </Button>
          )}
        </div>
      </header>
      <CatchUpNotice data={data} />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-7">
          <section aria-labelledby="focus-heading">
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="focus-heading"
                className="flex items-center gap-2 font-semibold"
              >
                <Sunrise size={18} className="text-primary" />
                오늘의 분량
              </h2>
              <span className="text-sm text-muted-foreground">
                {day.total}개 일정 ·{' '}
                {day.allDone
                  ? `${day.donePages}쪽 완료`
                  : `약 ${day.remainingMinutes}분 남음`}
              </span>
            </div>
            {sessions.length ? (
              <div className="space-y-3">
                {day.allDone && (
                  <p
                    role="status"
                    className="flex items-center gap-2 rounded-xl bg-success-soft px-4 py-3 text-sm font-medium text-success"
                  >
                    <Check size={16} aria-hidden="true" />
                    오늘 분량을 다 읽었어요
                  </p>
                )}
                {sessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    book={data.resources.find((r) => r.id === s.resource_id)}
                    completedThroughPage={
                      data.progress[s.resource_id]?.completedThroughPage ?? 0
                    }
                    today={data.today}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
                <BookOpen size={30} className="mx-auto mb-4 text-primary" />
                <h3 className="font-semibold">
                  {data.resources.length
                    ? '오늘은 예정된 학습이 없어요'
                    : '첫 책으로 시작해 볼까요?'}
                </h3>
                <p className="mx-auto mt-2 mb-6 max-w-sm text-sm leading-6 text-muted-foreground">
                  {data.resources.length
                    ? '다가오는 일정을 확인하거나, 아직 계획이 없는 책의 분량을 나눠 보세요.'
                    : '읽고 있는 책과 현재 페이지를 알려 주세요. 내 시간에 맞는 학습 계획을 만들 수 있어요.'}
                </p>
                <Button asChild>
                  <Link
                    href={
                      data.resources.length ? '/calendar' : '/resources/new'
                    }
                  >
                    {data.resources.length ? '캘린더 보기' : '첫 책 추가'}
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              </div>
            )}
          </section>
          <LearningToday
            minutes={
              statistics?.days.find((day) => day.date === data.today)
                ?.learningMinutes ?? null
            }
            goal={data.dailyLearningMinutes}
          />
          {!!withoutPlan.length && (
            <section className="rounded-xl bg-accent p-5">
              <h2 className="font-semibold">계획을 기다리는 책</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                하루에 읽을 분량을 정해 첫 일정을 만들어 보세요.
              </p>
              <div className="mt-4 space-y-2">
                {withoutPlan.slice(0, 3).map((r) => (
                  <Link
                    key={r.id}
                    href={`/resources/${r.id}`}
                    className="flex min-h-11 items-center justify-between gap-4 rounded-lg bg-card px-4 py-3 text-sm font-medium"
                  >
                    <span className="truncate">{r.title}</span>
                    <ArrowRight size={16} className="shrink-0" />
                  </Link>
                ))}
              </div>
            </section>
          )}
          {!!upcoming.length && (
            <section>
              <h2 className="mb-4 font-semibold">다가오는 학습</h2>
              <div className="space-y-4">
                {upcoming.map((s) => (
                  <div key={s.id}>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {formatDate(s.study_date)}
                    </p>
                    <SessionCard
                      session={s}
                      book={data.resources.find((r) => r.id === s.resource_id)}
                      completedThroughPage={
                        data.progress[s.resource_id]?.completedThroughPage ?? 0
                      }
                      today={data.today}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">나의 서재</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums">
              {data.resources.filter((r) => r.status !== 'ARCHIVED').length}
              <span className="ml-1 text-base font-normal text-muted-foreground">
                권
              </span>
            </p>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">읽는 중</dt>
                <dd>
                  {data.resources.filter((r) => r.status === 'ACTIVE').length}권
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">완독</dt>
                <dd>
                  {
                    data.resources.filter((r) => r.status === 'COMPLETED')
                      .length
                  }
                  권
                </dd>
              </div>
            </dl>
            <Link
              href="/resources"
              className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary"
            >
              서재 둘러보기
              <ArrowRight size={15} />
            </Link>
          </section>
          <StudyStreakCard today={data.today} data={statistics} />
        </aside>
      </div>
    </div>
  );
}

/** 오늘 화면의 잔디와 영어학습 카드가 같은 1년치 통계를 한 번만 받아 쓴다. */
function useYearStatistics(today: string) {
  const { apiFetch } = useAuth();
  const [data, setData] = useState<StatisticsData | null>(null);
  // 기록을 저장하면 잔디·연속일·이번 주·영어학습 분이 모두 달라진다.
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(WORKSPACE_CHANGED, refresh);
    return () => window.removeEventListener(WORKSPACE_CHANGED, refresh);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/statistics?from=${addDays(today, -365)}&to=${today}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '학습 기록을 불러오지 못했어요.');
        if (!controller.signal.aborted) setData(body as StatisticsData);
      })
      // 조용한 위젯: 실패해도 오늘 화면의 나머지 기능은 그대로 동작한다.
      .catch(() => {});
    return () => controller.abort();
  }, [apiFetch, today, revision]);
  return data;
}

function StudyStreakCard({ today, data }: { today: string; data: StatisticsData | null }) {
  if (!data) return <Skeleton className="h-40 w-full" />;
  const heatmapDays = buildHeatmap(data.days);
  const streak = computeStreak(heatmapDays, today);
  const todayEntry = data.days.find((day) => day.date === today);
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">학습 잔디</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums">
        {streak.current}
        <span className="ml-1 text-base font-normal text-muted-foreground">
          일 연속{streak.asOf !== today ? ' · 어제까지' : ''}
        </span>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        오늘 · 도서 {todayEntry?.recordedMinutes ?? 0}분 · 영어학습{' '}
        {todayEntry?.learningMinutes ?? 0}분
      </p>
      <ThisWeek days={heatmapDays} today={today} />
      <div className="mt-4">
        <StudyHeatmap days={heatmapDays} weeks={12} />
      </div>
      <Link
        href="/statistics"
        className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary"
      >
        통계에서 1년 전체 보기
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}

const weekdayLabels = ['월', '화', '수', '목', '금', '토', '일'];

/** 이번 주를 일곱 칸으로 보여 준다. 아직 오지 않은 날은 빠뜨린 날과 구분한다. */
function ThisWeek({ days, today }: { days: HeatmapDay[]; today: string }) {
  const week = currentWeek(days, today);
  const studied = countWeekDays(week);
  return (
    <section className="mt-5" aria-labelledby="this-week-heading">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 id="this-week-heading" className="text-sm font-medium">
          이번 주
        </h3>
        <span className="text-sm text-muted-foreground">{studied}일 학습</span>
      </div>
      <ol className="flex gap-1.5">
        {week.map((day) => (
          <li key={day.date} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[11px] text-muted-foreground">
              {weekdayLabels[day.isoWeekday - 1]}
            </span>
            <span
              aria-label={`${day.date} · ${day.studied ? '학습함' : day.isFuture ? '예정' : '기록 없음'}`}
              className={cn(
                'h-7 w-full rounded-md border',
                day.studied
                  ? 'border-primary bg-primary'
                  : day.isFuture
                    ? 'border-dashed border-border bg-transparent'
                    : 'border-border bg-muted',
                day.isToday && !day.studied && 'border-primary',
              )}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
