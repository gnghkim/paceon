'use client';
import { useQuickRecord } from './quick-record';
import { ArrowUpRight, BookOpen, Clock3 } from 'lucide-react';
import type { Resource, ScheduleSession } from '@paceon/shared';
export function SessionCard({
  session,
  book,
}: {
  session: ScheduleSession;
  book: Resource | undefined;
}) {
  const openRecord = useQuickRecord();
  return (
    <button
      type="button"
      onClick={() => openRecord(session.resource_id)}
      className="group flex w-full min-w-0 items-center gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/40"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
        <BookOpen size={20} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{book?.title ?? '도서'}</p>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>
            {session.start_page}–{session.end_page}쪽{' '}
            <span className="text-foreground">
              · {session.planned_workload}쪽
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock3 size={14} aria-hidden="true" />약{' '}
            {session.estimated_minutes ?? '—'}분
          </span>
        </div>
      </div>
      <span className="shrink-0 text-xs font-medium text-primary">
        학습 기록
      </span>
      <ArrowUpRight
        size={18}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground group-hover:text-primary"
      />
    </button>
  );
}
