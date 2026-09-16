'use client';
import { useQuickRecord } from './quick-record';
import { ArrowUpRight, BookOpen, Check, Clock3 } from 'lucide-react';
import type { Resource, ScheduleSession } from '@paceon/shared';
import { sessionState, type SessionStateKind } from '@/lib/session-state';
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
  const state = sessionState(session, completedThroughPage, today);
  const done = state.kind === 'COMPLETED';
  return (
    <button
      type="button"
      onClick={() => openRecord(session.resource_id)}
      className={cn(
        'group flex w-full min-w-0 items-center gap-4 rounded-xl border p-5 text-left transition-colors',
        done
          ? 'border-border bg-muted/40 hover:border-primary/30'
          : 'border-border bg-card hover:border-primary/40',
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
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate font-semibold',
            done && 'text-muted-foreground line-through decoration-1',
          )}
        >
          {book?.title ?? '도서'}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
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
        </div>
      </div>
      <span
        className={cn(
          'shrink-0 text-xs font-medium',
          done ? 'text-success' : state.kind === 'MISSED' ? 'text-warning' : 'text-primary',
        )}
      >
        {done ? label.COMPLETED : state.kind === 'MISSED' ? label.MISSED : '학습 기록'}
      </span>
      <ArrowUpRight
        size={18}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground group-hover:text-primary"
      />
    </button>
  );
}
