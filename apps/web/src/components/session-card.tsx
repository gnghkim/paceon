'use client';
import { useQuickRecord } from './quick-record';
import { ArrowUpRight, BookOpen, Check, Clock3 } from 'lucide-react';
import type { Resource, ScheduleSession } from '@paceon/shared';
import { sessionState, type SessionStateKind } from '@/lib/session-state';
import { StartReadingButton, useReadingTimer } from './reading-timer';
import { useUnitRecord } from './unit-record';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { describeSession } from '@/lib/session-presentation';

const label: Record<SessionStateKind, string> = {
  COMPLETED: '완료',
  IN_PROGRESS: '읽는 중',
  MISSED: '아직 안 읽음',
  PLANNED: '학습 기록',
};

interface SessionCardProps {
  session: ScheduleSession;
  book: Resource | undefined;
  completedThroughPage: number;
  today: string;
  /** 다음에 읽을 일정이면 읽기 시작을 채운 색으로 보여 준다. 화면에 하나뿐이다. */
  lead?: boolean;
  /** 챕터 일정일 때의 자료와 챕터. 책 일정에는 없다. */
  material?: Resource | undefined;
  unit?: { title: string; minutes: number | null } | undefined;
}

/** 일정 하나. 쪽 범위가 있으면 책의 카드, 챕터를 가리키면 챕터의 카드다. */
export function SessionCard(props: SessionCardProps) {
  const presentation = describeSession(props.session, props.material ?? props.book, props.unit);
  if (!presentation.href) return <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">{presentation.title}</p>;
  return props.session.unit_id ? <UnitSessionCard {...props} /> : <PageSessionCard {...props} />;
}

/**
 * 챕터 하나의 일정. 책의 카드와 같은 모양이지만 쪽 범위 대신 챕터 이름을 말하고,
 * 누르면 그 챕터가 골라진 채로 기록 창이 열린다.
 */
function UnitSessionCard({ session, material, unit, today, lead = false }: SessionCardProps) {
  const openUnitRecord = useUnitRecord();
  const { running } = useReadingTimer();
  const state = sessionState(session, 0, today);
  const done = state.kind === 'COMPLETED';
  const timing = running?.resourceId === session.resource_id && running.unit?.id === session.unit_id;
  const pausedHere = running?.pausedAt != null;
  const label = material?.unit_label ?? '챕터';
  const status = done ? '완료' : state.kind === 'MISSED' ? '아직 안 함' : '학습 기록';
  // 강의는 읽지 않는다. 자료의 종류에 맞는 말을 쓴다.
  const startLabel = material?.type === 'COURSE' ? '수강 시작' : '학습 시작';
  const presentation = describeSession(session, material, unit);
  return (
    <div
      className={cn(
        'group flex w-full min-w-0 flex-wrap items-center gap-4 rounded-xl border p-5 transition-colors sm:flex-nowrap',
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
        {done ? <Check size={20} aria-hidden="true" /> : <BookOpen size={20} aria-hidden="true" />}
      </span>
      <button
        type="button"
        onClick={() =>
          openUnitRecord({
            materialId: session.resource_id,
            ...(session.unit_id ? { unitId: session.unit_id } : {}),
            ...(done ? { mode: 'REPEAT' as const } : {}),
          })
        }
        className="min-w-0 flex-1 text-left"
      >
        <span
          className={cn(
            'block truncate font-semibold',
            done && 'text-muted-foreground line-through decoration-1',
          )}
        >
          {unit?.title ?? label}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="truncate">{presentation.title}</span>
          {!done && (
            <span className="inline-flex items-center gap-1.5">
              <Clock3 size={14} aria-hidden="true" />약 {unit?.minutes ?? session.estimated_minutes ?? '—'}분
            </span>
          )}
        </span>
        <span className="sr-only">{status}</span>
      </button>
      {timing ? (
        <span className={cn('shrink-0 text-xs font-medium', pausedHere ? 'text-muted-foreground' : 'text-primary')}>
          {pausedHere ? '잠시 멈춤' : '학습 중'}
        </span>
      ) : (
        <>
          {!done && (
            <StartReadingButton
              resourceId={session.resource_id}
              title={unit?.title ?? material?.title ?? label}
              unit={session.unit_id ? { id: session.unit_id } : {}}
              label={startLabel}
              emphasis={lead ? 'primary' : 'quiet'}
              className={lead ? 'order-last w-full sm:order-none sm:w-auto' : 'shrink-0'}
            />
          )}
          <span
            aria-hidden="true"
            className={cn(
              'hidden shrink-0 text-xs font-medium sm:inline',
              done ? 'text-success' : state.kind === 'MISSED' ? 'text-warning' : 'text-primary',
            )}
          >
            {status}
          </span>
        </>
      )}
      <Link href={presentation.href!} aria-label={`${presentation.title} 상세`} className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-primary"><ArrowUpRight size={18} aria-hidden="true" /></Link>
    </div>
  );
}

function PageSessionCard({
  session,
  book,
  completedThroughPage,
  today,
  lead = false,
}: SessionCardProps) {
  const openRecord = useQuickRecord();
  const { running } = useReadingTimer();
  const pausedHere = running?.pausedAt != null;
  const state = sessionState(session, completedThroughPage, today);
  const done = state.kind === 'COMPLETED';
  const presentation = describeSession(session, book);
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
        'group flex w-full min-w-0 flex-wrap items-center gap-4 rounded-xl border p-5 transition-colors sm:flex-nowrap',
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
            {presentation.detail}{' '}
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
        <span
          className={cn(
            'shrink-0 text-xs font-medium',
            pausedHere ? 'text-muted-foreground' : 'text-primary',
          )}
        >
          {pausedHere ? '잠시 멈춤' : '읽는 중'}
        </span>
      ) : (
        <>
          {!done && (
            <StartReadingButton
              resourceId={session.resource_id}
              {...(book?.title ? { title: book.title } : {})}
              emphasis={lead ? 'primary' : 'quiet'}
              // 좁은 화면에서 채운 단추는 아래 줄을 통째로 쓴다. 제목을 밀어내지 않고 더 잘 보인다.
              className={lead ? 'order-last w-full sm:order-none sm:w-auto' : 'shrink-0'}
            />
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
      <Link href={presentation.href!} aria-label={`${presentation.title} 상세`} className="inline-flex min-h-11 min-w-11 items-center justify-center text-muted-foreground hover:text-primary"><ArrowUpRight
        size={18}
        aria-hidden="true"
        className="shrink-0 text-muted-foreground group-hover:text-primary"
      /></Link>
    </div>
  );
}
