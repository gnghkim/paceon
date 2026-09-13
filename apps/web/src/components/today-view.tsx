'use client';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Plus,
  Sunrise,
} from 'lucide-react';
import {
  useWorkspace,
  WorkspaceLoading,
  WorkspaceError,
} from './workspace-data';
import { Button } from './ui/button';
import { SessionCard } from './session-card';
import { formatDate } from '@/lib/planning';

export function TodayView() {
  const { data, error, reload } = useWorkspace();
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <WorkspaceLoading />;
  const sessions = data.sessions.filter(
    (s) => s.study_date === data.today && s.status !== 'SKIPPED',
  );
  const minutes = sessions.reduce(
    (sum, s) => sum + (s.estimated_minutes ?? 0),
    0,
  );
  const upcoming = data.sessions
    .filter((s) => s.study_date > data.today && s.status !== 'SKIPPED')
    .slice(0, 3);
  const withoutPlan = data.resources.filter(
    (r) =>
      r.status === 'ACTIVE' &&
      !data.plans.some((p) => p.resource_id === r.id && p.status === 'ACTIVE'),
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
        <Button asChild variant="outline">
          <Link href="/resources/new">
            <Plus size={16} />
            자료 추가
          </Link>
        </Button>
      </header>
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
                {sessions.length}개 일정 · 약 {minutes}분
              </span>
            </div>
            {sessions.length ? (
              <div className="space-y-3">
                {sessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    book={data.resources.find((r) => r.id === s.resource_id)}
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
                    {data.resources.length ? '캘린더 보기' : '첫 자료 추가'}
                    <ArrowRight size={16} />
                  </Link>
                </Button>
              </div>
            )}
          </section>
          {!!data.resources.filter((r) =>
            data.plans.some(
              (p) => p.resource_id === r.id && p.status === 'ACTIVE',
            ),
          ).length && (
            <section className="space-y-3">
              <h2 className="font-semibold">오늘 읽은 진도 남기기</h2>
              <p className="text-sm text-muted-foreground">
                오늘 예정된 일정이 없어도 읽은 페이지를 기록할 수 있어요.
              </p>
              <div className="flex flex-wrap gap-2">
                {data.resources
                  .filter((r) =>
                    data.plans.some(
                      (p) => p.resource_id === r.id && p.status === 'ACTIVE',
                    ),
                  )
                  .map((r) => (
                    <Button key={r.id} asChild variant="outline">
                      <Link
                        href={`/resources/${r.id}#record`}
                        className="max-w-full"
                      >
                        <span className="truncate">{r.title} · 학습 기록</span>
                      </Link>
                    </Button>
                  ))}
              </div>
            </section>
          )}
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
              {data.resources.length}
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
          <section className="rounded-xl bg-muted p-6">
            <CalendarDays size={21} className="text-muted-foreground" />
            <h2 className="mt-3 font-medium">꾸준함을 위한 여유</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              계획은 내가 정한 학습 가능 시간 안에서 만들어져요. 오늘의 분량부터
              천천히 살펴보세요.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
