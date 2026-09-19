'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, toStudyDate } from '@paceon/scheduler';
import { calendarDays, formatDate } from '@/lib/planning';
import {
  useWorkspace,
  WorkspaceError,
  WorkspaceLoading,
} from './workspace-data';
import { Button } from './ui/button';
import { SessionCard } from './session-card';
import type { ScheduleSession } from '@paceon/shared';
import {
  sessionState,
  summarizeDay,
  type SessionStateKind,
} from '@/lib/session-state';
const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
export function CalendarView() {
  const { data, error, reload } = useWorkspace();
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <WorkspaceLoading />;
  return <CalendarContent initialDate={data.today} />;
}
function CalendarContent({ initialDate }: { initialDate: string }) {
  const [anchor, setAnchor] = useState(initialDate);
  const [view, setView] = useState<'week' | 'month' | 'day'>('week');
  const [selected, setSelected] = useState(anchor);
  const month = calendarDays(anchor);
  const monday = addDays(
    anchor,
    -((new Date(`${anchor}T12:00:00Z`).getUTCDay() + 6) % 7),
  );
  const days =
    view === 'month'
      ? month
      : view === 'day'
        ? [anchor]
        : Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const { data, error, reload } = useWorkspace(
    `?from=${days[0]}&to=${days[days.length - 1]}`,
  );
  function move(direction: number) {
    let next = addDays(anchor, direction * (view === 'week' ? 7 : 1));
    if (view === 'month') {
      const d = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + direction);
      next = d.toISOString().slice(0, 10);
    }
    setAnchor(next);
    setSelected(next);
  }
  const visible = data?.sessions.filter((s) => s.status !== 'SKIPPED') ?? [];
  const focusedDay = days.includes(selected) ? selected : anchor;
  const agenda = visible.filter((s) => s.study_date === focusedDay);
  return (
    <div className="space-y-7">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">
          하루씩 쌓이는 나의 계획
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">학습 캘린더</h1>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => move(-1)}
            aria-label="이전 기간"
          >
            <ChevronLeft size={18} />
          </Button>
          <h2 className="min-w-32 text-center font-semibold">
            {anchor.slice(0, 4)}년 {Number(anchor.slice(5, 7))}월
          </h2>
          <Button
            variant="outline"
            size="icon"
            onClick={() => move(1)}
            aria-label="다음 기간"
          >
            <ChevronRight size={18} />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const today =
                data?.today ??
                toStudyDate(new Date().toISOString(), 'Asia/Seoul');
              setAnchor(today);
              setSelected(today);
            }}
          >
            오늘
          </Button>
        </div>
        <div
          className="flex rounded-lg border border-border bg-card p-1"
          aria-label="캘린더 보기"
        >
          {(['day', 'week', 'month'] as const).map((mode, i) => (
            <Button
              key={mode}
              variant={view === mode ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >
              {['일', '주', '월'][i]}
            </Button>
          ))}
        </div>
      </div>
      {error ? (
        <WorkspaceError error={error} reload={reload} />
      ) : !data ? (
        <WorkspaceLoading />
      ) : (
        <>
          {view !== 'day' && (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <div className="grid grid-cols-7 border-b border-border bg-muted/50">
                {weekdays.map((day) => (
                  <span
                    key={day}
                    className="py-3 text-center text-xs font-medium text-muted-foreground"
                  >
                    {day}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const items = visible.filter((s) => s.study_date === day);
                  const summary = summarizeDay(items, data.progress, data.today);
                  const missed =
                    day < data.today &&
                    items.some(
                      (s) =>
                        sessionState(
                          s,
                          data.progress[s.resource_id]?.completedThroughPage ?? 0,
                          data.today,
                        ).kind === 'MISSED',
                    );
                  return (
                    <div
                      key={day}
                      className={`min-w-0 border-r border-b border-border p-1 sm:p-2 ${view === 'month' ? 'min-h-16 sm:min-h-28' : 'min-h-24 sm:min-h-56'} ${day.slice(0, 7) !== anchor.slice(0, 7) ? 'bg-muted/40' : ''} ${day === focusedDay ? 'bg-accent/60' : ''}`}
                    >
                      <button
                        onClick={() => setSelected(day)}
                        aria-label={`${formatDate(day, true)}, 일정 ${items.length}개`}
                        aria-pressed={day === focusedDay}
                        className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm ${day === data.today ? 'bg-primary text-white' : 'hover:bg-muted'}`}
                      >
                        {Number(day.slice(8))}
                      </button>
                      <div className="mt-1 hidden space-y-1 sm:block">
                        {items.slice(0, view === 'month' ? 2 : 5).map((s) => (
                          <DayChip
                            key={s.id}
                            session={s}
                            title={
                              data.resources.find((r) => r.id === s.resource_id)
                                ?.title
                            }
                            completedThroughPage={
                              data.progress[s.resource_id]
                                ?.completedThroughPage ?? 0
                            }
                            today={data.today}
                          />
                        ))}
                        {items.length > (view === 'month' ? 2 : 5) && (
                          <span className="block text-center text-xs text-muted-foreground">
                            +{items.length - (view === 'month' ? 2 : 5)}개
                          </span>
                        )}
                      </div>
                      {!!items.length && (
                        <span
                          className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full sm:hidden ${
                            summary.allDone
                              ? 'bg-success'
                              : missed
                                ? 'bg-warning'
                                : 'bg-primary'
                          }`}
                          aria-hidden="true"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <section>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">
                {formatDate(focusedDay)} 일정{' '}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {agenda.length}개
                  {summarizeDay(agenda, data.progress, data.today).allDone
                    ? ' · 모두 완료'
                    : ''}
                </span>
              </h2>
              <span className="text-xs text-muted-foreground">
                {data.timezone} 기준
              </span>
            </div>
            {agenda.length ? (
              <div className="space-y-3">
                {agenda.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    book={data.resources.find((r) => r.id === s.resource_id)}
                    material={data.materials.find((r) => r.id === s.resource_id)}
                    unit={s.unit_id ? data.units[s.unit_id] : undefined}
                    completedThroughPage={
                      data.progress[s.resource_id]?.completedThroughPage ?? 0
                    }
                    today={data.today}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  이날은 예정된 학습이 없어요.
                </p>
                <Button variant="ghost" asChild className="mt-2">
                  <Link href="/resources">서재에서 계획 세우기</Link>
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const chipClass: Record<SessionStateKind, string> = {
  COMPLETED: 'border-success bg-success-soft text-success',
  MISSED: 'border-warning bg-warning-soft text-warning',
  IN_PROGRESS: 'border-primary bg-primary-soft text-primary',
  PLANNED: 'border-primary bg-accent text-accent-foreground',
};

function DayChip({
  session,
  title,
  completedThroughPage,
  today,
}: {
  session: ScheduleSession;
  title: string | undefined;
  completedThroughPage: number;
  today: string;
}) {
  const { kind } = sessionState(session, completedThroughPage, today);
  return (
    <Link
      href={`/resources/${session.resource_id}`}
      title={title}
      className={`block truncate rounded border-l-2 px-2 py-2 text-xs ${chipClass[kind]}`}
    >
      {title ?? '도서'}
      <span className="mt-1 block text-[11px]">
        {session.start_page}–{session.end_page}쪽
      </span>
    </Link>
  );
}
