'use client';
import { useQuickRecord } from './quick-record';
import { ArrowUpRight, BookOpen, Check, Clock3 } from 'lucide-react';
import type { Resource, ScheduleSession } from '@paceon/shared';
import { sessionState, type SessionStateKind } from '@/lib/session-state';
import { StartReadingButton, useReadingTimer } from './reading-timer';
import { cn } from '@/lib/utils';

const label: Record<SessionStateKind, string> = {
  COMPLETED: '완료',
  IN_PROGRESS: '읽는 중',
  MISSED: '아직 안 읽음',
  PLANNED: '학습 기록',
};

export function SessionCard({
  session,
  book,
  completedThroughPage,
  today,
}: {
  session: ScheduleSession;
  book: Resource | undefined;
  completedThroughPage: number;
  today: string;
}) {
  const openRecord = useQuickRecord();
  const { running } = useReadingTimer();
  const state = sessionState(session, completedThroughPage, today);
  const done = state.kind === 'COMPLETED';
  // 같은 책의 내일 일정까지 "읽는 중"으로 보이면 안 된다. 오늘 몫에만 표시한다.
  const timing =
    running?.resourceId === session.resource_id && session.study_date === today;
  const status = done
    ? label.COMPLETED
    : state.kind === 'MISSED'
      ? label.MISSED
      : '학습 기록';
  return (
    // 카드 안에 버튼이 둘이므로 카드 자체는 버튼이 아니다. 내용 영역이 기록을 여는
    // 버튼이고, 읽기 시작은 그 옆의 별도 버튼이다. 버튼 안에 버튼을 넣을 수 없다.
    <div
      className={cn(
        'group flex w-full min-w-0 items-center gap-4 rounded-xl border p-5 transition-colors',
        done
          ? 'border-border bg-muted/40 focus-within:border-primary/30'
          : 'border-border bg-card focus-within:border-primary/40 hover:border-primary/40',
        state.kind === 'MISSED' && 'border-warning',
      )}
    >
      <span
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
          done ? 'bg-success-soft text-success' : 'bg-accent text-primary',
        )}
      >
        {done ? (
          <Check size={20} aria-hidden="true" />
        ) : (
          <BookOpen size={20} aria-hidden="true" />
        )}
      </span>
      <button
        type="button"
        onClick={() => openRecord(session.resource_id)}
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            'block truncate font-semibold',
            done && 'text-muted-foreground line-through decoration-1',
          )}
        >
          {book?.title ?? '도서'}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {session.start_page}–{session.end_page}쪽{' '}
            <span className={done ? undefined : 'text-foreground'}>
              · {session.planned_workload}쪽
            </span>
          </span>
          {state.kind === 'IN_PROGRESS' ? (
            <span className="text-primary">
              {state.donePages}쪽 읽음 · {state.remainingPages}쪽 남음
            </span>
          ) : (
            !done && (
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={14} aria-hidden="true" />약{' '}
                {session.estimated_minutes ?? '—'}분
              </span>
            )
          )}
        </span>
        <span className="sr-only">{status}</span>
      </button>
      {timing ? (
        <span className="shrink-0 text-xs font-medium text-primary">읽는 중</span>
      ) : (
        <>
          {!done && (
            <StartReadingButton resourceId={session.resource_id} className="shrink-0" />
          )}
          <span
            aria-hidden="true"
            className={cn(
              'hidden shrink-0 text-xs font-medium sm:inline',
              done
                ? 'text-success'
                : state.kind === 'MISSED'
                  ? 'text-warning'
                  : 'text-primary',
            )}
          >
            {status}
          </span>
        </>
      )}
      <ArrowUpRight
        size={18}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground group-hover:text-primary"
      />
    </div>
  );
}
