'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ProgressForm,
  ProgressResult,
  type ProgressSummary,
} from './progress-form';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-data';
import { BookCover } from '@/components/book-library';
import { AiInsight } from '@/components/ai-insight';
import { PdfSourceCard } from '@/components/pdf-source';
import { PlanForm } from '@/components/plan-form';
import { PlanSettings } from '@/components/plan-settings';
import { StartReadingButton, useReadingTimer } from '@/components/reading-timer';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate, summarizeBook } from '@/lib/planning';

export function BookDetail({ id }: { id: string }) {
  return <BookDetailPanel key={id} id={id} />;
}

function BookDetailPanel({ id }: { id: string }) {
  const [saved, setSaved] = useState<ProgressSummary | null>(null);
  const [pdfOutline, setPdfOutline] = useState('');
  const { data, loading, error, reload } = useWorkspace(
    `?resourceId=${encodeURIComponent(id)}`,
  );
  if (loading)
    return (
      <div
        role="status"
        aria-label="도서 정보 불러오는 중"
        className="space-y-6"
      >
        <div className="h-60 animate-pulse rounded-xl bg-muted" />
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  if (error)
    return (
      <Card className="space-y-4 p-6">
        <p role="alert">{error}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reload}>
            다시 불러오기
          </Button>
          <Button asChild variant="ghost">
            <Link href="/resources">내 서재로</Link>
          </Button>
        </div>
      </Card>
    );
  const book = data?.resources.find((resource) => resource.id === id);
  if (!data || !book)
    return (
      <Card className="space-y-4 p-6">
        <h1 className="text-lg font-semibold">책을 찾을 수 없어요</h1>
        <p className="text-sm text-muted-foreground">
          내 서재에서 등록한 책을 확인해 주세요.
        </p>
        <Button asChild>
          <Link href="/resources">내 서재로</Link>
        </Button>
      </Card>
    );
  const bookPlans = data.plans.filter((p) => p.resource_id === id);
  const plan =
    bookPlans.find((p) => p.status === 'ACTIVE' || p.status === 'PAUSED') ??
    bookPlans
      .filter((p) => p.status === 'COMPLETED')
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const baseline = summarizeBook(book, plan);
  const progress = data.progress[id];
  const summary = {
    ...baseline,
    completed: progress?.completedThroughPage ?? baseline.completed,
    percent: progress?.percent ?? baseline.percent,
  };
  const history = data.events
    .filter((event) => event.resource_id === id)
    .sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
  const voided = new Set(
    history
      .filter((event) => event.event_type === 'VOID')
      .map((event) => event.voids_event_id),
  );
  const sessions = data.sessions
    .filter(
      (s) =>
        s.resource_id === id &&
        s.study_date >= data.today &&
        s.status !== 'COMPLETED' &&
        s.status !== 'SKIPPED',
    )
    .sort((a, b) => a.study_date.localeCompare(b.study_date));
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Button asChild variant="ghost" className="-ml-3">
        <Link href="/resources">
          <ArrowLeft className="size-4" />내 서재
        </Link>
      </Button>
      <header className="flex items-start gap-5 md:gap-8">
        <BookCover url={book.cover_url} title={book.title} large />
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs text-muted-foreground">
            {book.source === 'PDF_IMPORT' && <span>PDF · </span>}
            {book.status === 'ARCHIVED'
              ? '보관한 책'
              : book.status === 'COMPLETED'
                ? '완독한 책'
                : plan?.status === 'PAUSED'
                  ? '잠시 멈춘 책'
                  : '읽고 있는 책'}
          </p>
          <h1 className="break-words text-2xl font-bold tracking-tight md:text-[28px]">
            {book.title}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {book.author || '저자 정보 없음'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {[book.publisher, `${book.total_pages}쪽`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {book.isbn && (
            <p className="mt-2 break-all text-xs text-muted-foreground">
              ISBN {book.isbn}
            </p>
          )}
        </div>
      </header>
      <Card id="book-progress" className="grid scroll-mt-6 gap-6 p-4 md:grid-cols-2 md:p-6">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="text-sm text-muted-foreground">현재 읽은 진도</h2>
            <span className="text-sm font-semibold">{summary.percent}%</span>
          </div>
          <p className="mt-2 text-xl font-semibold">
            {summary.completed}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              / {book.total_pages}쪽
            </span>
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${summary.percent}%` }}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            등록 시 진도와 유효한 읽기 기록을 합산했어요. 복습과 무효 기록은
            제외합니다.
          </p>
          {book.status === 'ACTIVE' && (
            <div className="mt-4">
              <ReadingControl resourceId={book.id} />
            </div>
          )}
        </div>
        <div className="border-t border-border pt-5 md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <h2 className="text-sm text-muted-foreground">예상 완독</h2>
          <p className="mt-2 text-xl font-semibold">
            {book.status === 'COMPLETED'
              ? '이미 완독한 책이에요'
              : formatDate(summary.forecast, true)}
          </p>
          {summary.target && (
            <p className="mt-3 text-sm text-muted-foreground">
              목표 · {formatDate(summary.target, true)}
            </p>
          )}
          {plan && (
            <p className="mt-3 text-xs text-muted-foreground">
              {book.replan_required
                ? '일정 조정 대기 · 기존 계획의 예상 날짜입니다.'
                : '저장된 독서 계획 기준'}
            </p>
          )}
        </div>
      </Card>
      {saved && <ProgressResult result={saved} />}
      {plan && (
        <ProgressForm
          key={`${book.id}:${book.progress_version}:${plan.version}`}
          book={book}
          plan={plan}
          data={data}
          onSaved={reload}
          onResult={setSaved}
        />
      )}
      {plan && (
        <Card className="p-4 md:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">다가오는 독서 일정</h2>
            <Button asChild variant="ghost">
              <Link href="/calendar">
                <CalendarDays className="size-4" />
                캘린더 보기
              </Link>
            </Button>
          </div>
          {sessions.length ? (
            <ul className="divide-y divide-border">
              {sessions.slice(0, 7).map((session) => (
                <li
                  key={session.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {session.study_date === data.today ? '오늘 · ' : ''}
                      {formatDate(session.study_date)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      예정된 독서
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm">
                      {session.start_page}–{session.end_page}쪽
                    </p>
                    {session.estimated_minutes !== null && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        약 {Math.ceil(session.estimated_minutes)}분
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              조회 기간에 예정된 독서가 없어요. 캘린더에서 다른 날짜를 확인해
              주세요.
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {formatDate(data.today)}부터 {formatDate(data.to)}까지의 일정 중
            최대 7개를 표시합니다.
          </p>
        </Card>
      )}
      {plan && plan.status !== 'COMPLETED' && (
        <PlanSettings
          key={`settings:${book.id}:${book.progress_version}:${plan.version}:${plan.status}:${book.status}`}
          book={book}
          plan={plan}
          onSaved={reload}
          onResult={setSaved}
        />
      )}
      {!plan && book.status !== 'COMPLETED' && (
        <div id="reading-plan" className="scroll-mt-6">
          <PlanForm key={book.id} book={book} data={data} onSaved={reload} />
        </div>
      )}
      <AiInsight resourceId={book.id} initialOutline={pdfOutline} planHref={plan ? '#record' : book.status === 'COMPLETED' ? '#book-progress' : '#reading-plan'} />
      <PdfSourceCard key={book.id} resourceId={book.id} onOutline={setPdfOutline} />
      <Card className="space-y-4 p-4 md:p-6">
        <h2 className="text-lg font-semibold">학습 기록 이력</h2>
        <p className="text-xs text-muted-foreground">
          최근 기록 20개를 표시해요. 정정 전 기록과 무효 처리도 이력에 남습니다.
        </p>
        {history.length ? (
          <ul className="divide-y divide-border">
            {history.slice(0, 20).map((event) => (
              <li key={event.id} className="space-y-1 py-3 text-sm">
                <p className="font-medium">
                  {formatDate(event.study_date, true)} ·{' '}
                  {event.event_type === 'VOID'
                    ? '정정 · 이전 기록 무효 처리'
                    : event.event_type === 'REVIEW'
                      ? '복습 · 진도에 미포함'
                      : voided.has(event.id)
                        ? '읽기 · 무효 (정정됨)'
                        : '읽기 · 유효'}
                  {event.id === progress?.latestLearningId
                    ? ' · 마지막 읽기 기록'
                    : ''}
                </p>
                {event.event_type !== 'VOID' && (
                  <p className="text-muted-foreground">
                    {event.start_page}–{event.end_page}쪽
                    {event.duration_minutes !== null
                      ? ` · ${event.duration_minutes}분`
                      : ''}
                  </p>
                )}
                {event.memo && (
                  <p className="whitespace-pre-wrap break-words text-muted-foreground">
                    {event.memo}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            아직 기록한 학습이 없어요. 오늘 읽은 페이지를 남겨 보세요.
          </p>
        )}
      </Card>
    </div>
  );
}

/** 이 책을 재는 중이면 상태를, 아니면 시작 버튼을 보여 준다. */
function ReadingControl({ resourceId }: { resourceId: string }) {
  const { running } = useReadingTimer();
  if (running?.resourceId === resourceId)
    return (
      <p className="text-sm text-primary">
        읽는 시간을 재고 있어요. 위쪽 띠에서 끝낼 수 있어요.
      </p>
    );
  return <StartReadingButton resourceId={resourceId} />;
}
