'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Plan, Resource } from '@paceon/shared';
import type { WorkspaceData } from '@/lib/workspace-types';
import { useAuth } from './auth-provider';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatDate } from '@/lib/planning';

export interface ProgressSummary {
  completedThroughPage: number;
  replanStatus: 'applied' | 'pending';
  forecastBefore: string | null;
  forecastAfter: string | null;
  conflicts: { code: string }[];
}

const conflictMessages: Record<string, string> = {
  NO_AVAILABILITY:
    '학습 가능한 시간이 부족해요. 기존 학습 시간을 확인해 주세요.',
  TIME_CAPACITY:
    '다른 책의 일정이나 고정 일정과 겹쳐요. 하루 분량을 줄이거나 목표 날짜를 늦춰 보세요.',
  TARGET_IN_PAST: '목표 날짜가 지났어요. 새로운 목표 날짜를 선택해 주세요.',
  INVALID_INPUT:
    '현재 일정과 설정으로 조정하기 어려워요. 분량과 목표 날짜를 확인해 주세요.',
};

export function ProgressResult({ result }: { result: ProgressSummary }) {
  return (
    <Card
      role="status"
      className="space-y-2 border-primary/30 bg-accent/40 p-4"
    >
      <p className="font-semibold">
        기록을 저장했어요 · 현재 {result.completedThroughPage}쪽
      </p>
      <p className="text-sm">
        예상 완독:{' '}
        {result.forecastBefore
          ? formatDate(result.forecastBefore, true)
          : '미정'}{' '}
        →{' '}
        {result.replanStatus === 'pending'
          ? '조정 대기'
          : result.forecastAfter
            ? formatDate(result.forecastAfter, true)
            : '미정'}
      </p>
      {result.replanStatus === 'pending' && (
        <>
          <p className="text-sm">
            읽은 기록은 반영했어요. 기존 일정을 유지한 채 일정 조정을 기다리고
            있어요.
          </p>
          {[
            ...new Set(
              result.conflicts.map(
                (c) =>
                  conflictMessages[c.code] ??
                  '기존 일정과 함께 배치하기 어려워요. 설정을 바꾸고 다시 조정해 주세요.',
              ),
            ),
          ].map((message) => (
            <p key={message} className="text-sm text-muted-foreground">
              {message}
            </p>
          ))}
        </>
      )}
    </Card>
  );
}

type Kind = 'LEARNING' | 'REVIEW' | 'CORRECTION' | 'REPLAN';
export function ProgressForm({
  book,
  plan,
  data,
  onSaved,
  onResult,
  compact = false,
  onLockedChange,
}: {
  book: Resource;
  plan: Plan;
  data: WorkspaceData;
  onSaved: () => void;
  onResult?: (result: ProgressSummary) => void;
  compact?: boolean;
  onLockedChange?: (locked: boolean) => void;
}) {
  const { apiFetch } = useAuth();
  const completed =
    data.progress[book.id]?.completedThroughPage ??
    book.initial_completed_workload;
  const latest = data.events.find(
    (event) => event.id === data.progress[book.id]?.latestLearningId,
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: plan.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [kind, setKind] = useState<Kind>(
    completed >= (book.total_pages ?? 0) ? 'REVIEW' : 'LEARNING',
  );
  const [endPage, setEndPage] = useState('');
  const [startPage, setStartPage] = useState('1');
  const [studyDate, setStudyDate] = useState(today);
  const [duration, setDuration] = useState('');
  const [memo, setMemo] = useState('');
  const [mode, setMode] = useState(plan.mode);
  const [dailyPages, setDailyPages] = useState(
    String(plan.preferred_daily_workload ?? 20),
  );
  const [targetDate, setTargetDate] = useState(plan.target_date ?? '');
  const [busy, setBusy] = useState(false);
  const [ambiguous, setAmbiguous] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ProgressSummary | null>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    onLockedChange?.(busy || ambiguous);
  }, [busy, ambiguous, onLockedChange]);
  const inFlight = useRef(false);
  const requestBody = useRef<string | null>(null);
  function changeKind(next: Kind) {
    setKind(next);
    setError('');
    setEndPage(next === 'CORRECTION' ? String(latest?.end_page ?? '') : '');
    setStudyDate(next === 'CORRECTION' ? (latest?.study_date ?? today) : today);
    setDuration(
      next === 'CORRECTION' && latest?.duration_minutes != null
        ? String(latest.duration_minutes)
        : '',
    );
    setMemo(next === 'CORRECTION' ? (latest?.memo ?? '') : '');
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current || stale) return;
    if (!requestBody.current) {
      const request = {
        kind,
        idempotencyKey: crypto.randomUUID(),
        planId: plan.id,
        expectedPlanVersion: plan.version,
        expectedProgressVersion: book.progress_version,
        ...(kind === 'REPLAN'
          ? {
              mode,
              ...(mode !== 'DEADLINE'
                ? { dailyPages: Number(dailyPages) }
                : {}),
              targetDate: targetDate || null,
            }
          : {
              studyDate,
              endPage: Number(endPage),
              durationMinutes: duration === '' ? null : Number(duration),
              memo,
              ...(kind === 'REVIEW' ? { startPage: Number(startPage) } : {}),
              ...(kind === 'CORRECTION' ? { eventId: latest?.id } : {}),
            }),
      };
      requestBody.current = JSON.stringify(request);
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        `/api/resources/books/${book.id}/progress`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody.current,
        },
      );
      if (response.status >= 500) throw new Error('ambiguous');
      const payload = await response.json();
      if (!response.ok) {
        setAmbiguous(false);
        if (response.status === 409) {
          setStale(true);
          setError(
            '진도나 일정이 다른 곳에서 변경되었어요. 최신 정보를 불러온 뒤 내용을 확인하고 다시 기록해 주세요.',
          );
        } else {
          requestBody.current = null;
          setError(
            response.status === 400
              ? '페이지 범위, 날짜와 학습 시간을 확인해 주세요. 마지막 기록만 정정할 수 있어요.'
              : '기록을 저장하지 못했어요. 로그인 상태와 책 정보를 확인해 주세요.',
          );
        }
        return;
      }
      setAmbiguous(false);
      setResult(payload as ProgressSummary);
      onResult?.(payload as ProgressSummary);
      onSaved();
    } catch {
      setAmbiguous(true);
      setError(
        '저장 결과를 확인하지 못했어요. 같은 요청으로 다시 확인하면 중복 저장되지 않아요. 내용을 바꾸려면 최신 기록을 먼저 불러와 주세요.',
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Card
      id={compact ? undefined : 'record'}
      className={
        compact
          ? 'space-y-4 border-0 shadow-none'
          : 'scroll-mt-6 space-y-5 p-4 md:p-6'
      }
    >
      <div>
        {!compact && <h2 className="text-lg font-semibold">학습 기록</h2>}
        <p className="mt-1 text-sm text-muted-foreground">
          현재 {completed}쪽까지 읽었어요 · 남은{' '}
          {Math.max(0, (book.total_pages ?? 0) - completed)}쪽
        </p>
      </div>
      {book.replan_required && (
        <p className="rounded-lg bg-muted p-3 text-sm">
          기록은 저장되어 있어요. 일정 조정이 필요하니 ‘일정 다시 조정’에서
          설정을 확인해 주세요.
        </p>
      )}
      <form
        onSubmit={submit}
        className="space-y-4"
        onInvalidCapture={(event) => {
          const field = event.target;
          if (
            compact &&
            field instanceof HTMLInputElement &&
            field.closest('.hidden')
          ) {
            event.preventDefault();
            setExpanded(true);
            setError('날짜와 학습 시간을 확인해 주세요.');
            requestAnimationFrame(() => field.focus());
          }
        }}
      >
        <fieldset
          disabled={busy || ambiguous || stale || !!result}
          className="space-y-4"
        >
          <legend className="sr-only">기록 종류와 내용</legend>
          <div
            className={compact && !expanded ? 'hidden' : 'flex flex-wrap gap-2'}
          >
            {(
              [
                ['LEARNING', '읽은 진도'],
                ['REVIEW', '복습'],
                ...(!compact ? [['CORRECTION', '마지막 기록 정정']] : []),
                ...(!compact && book.replan_required
                  ? [['REPLAN', '일정 다시 조정']]
                  : []),
              ] as [Kind, string][]
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={kind === value ? 'secondary' : 'outline'}
                aria-pressed={kind === value}
                disabled={
                  (value === 'CORRECTION' && !latest) ||
                  (value === 'LEARNING' && completed >= (book.total_pages ?? 0))
                }
                onClick={() => changeKind(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {kind === 'CORRECTION' && latest && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                마지막 읽기 기록 {latest.start_page}–{latest.end_page}쪽을
                정정합니다. {Math.max(0, (latest.start_page ?? 1) - 1)}쪽을
                입력하면 이 기록 전체가 무효 처리돼요. 원래 기록과 정정 이력은
                삭제되지 않습니다.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEndPage(String((latest.start_page ?? 1) - 1))}
              >
                마지막 읽기 기록 전체 무효 처리 선택
              </Button>
            </div>
          )}
          {kind === 'REVIEW' && (
            <p className="text-sm text-muted-foreground">
              다시 읽은 범위를 기록해요. 복습은 읽은 진도를 늘리지 않아요.
            </p>
          )}
          {kind === 'REPLAN' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span>조정 방식</span>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Plan['mode'])}
                >
                  <option value="PACE">하루 분량 유지</option>
                  <option value="DEADLINE">목표 날짜에 맞추기</option>
                  <option value="BALANCED">균형 조정</option>
                </select>
              </label>
              {mode !== 'DEADLINE' && (
                <label className="space-y-2 text-sm">
                  <span>하루 읽을 분량 (쪽)</span>
                  <Input
                    type="number"
                    min={1}
                    max={10000000}
                    step={1}
                    required
                    value={dailyPages}
                    onChange={(e) => setDailyPages(e.target.value)}
                  />
                </label>
              )}
              <label className="space-y-2 text-sm">
                <span>목표 완독 날짜 {mode !== 'DEADLINE' && '(선택)'}</span>
                <Input
                  type="date"
                  min={today}
                  required={mode === 'DEADLINE'}
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                다른 책과 함께 사용하는 기존 학습 가능 시간을 유지해요.
              </p>
            </div>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {kind === 'REVIEW' && (
                  <label className="space-y-2 text-sm">
                    <span>복습 시작 페이지</span>
                    <Input
                      type="number"
                      min={1}
                      max={book.total_pages ?? undefined}
                      inputMode="numeric"
                      step={1}
                      required
                      value={startPage}
                      onChange={(e) => setStartPage(e.target.value)}
                    />
                  </label>
                )}
                <label className="space-y-2 text-sm">
                  <span>
                    {kind === 'REVIEW'
                      ? '복습 마지막 페이지'
                      : compact
                        ? '오늘 어디까지 읽었나요? (마지막 페이지)'
                        : '마지막으로 읽은 페이지'}
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    autoFocus={compact}
                    min={
                      kind === 'LEARNING'
                        ? completed + 1
                        : kind === 'CORRECTION'
                          ? (latest?.start_page ?? 1) - 1
                          : Number(startPage)
                    }
                    max={book.total_pages ?? undefined}
                    step={1}
                    required
                    value={endPage}
                    onChange={(e) => setEndPage(e.target.value)}
                  />
                </label>
                {compact &&
                  kind === 'LEARNING' &&
                  endPage !== '' &&
                  Number(endPage) > completed &&
                  Number(endPage) <= (book.total_pages ?? 0) && (
                    <p
                      role="status"
                      className="text-sm font-medium text-primary sm:col-span-2"
                    >
                      {studyDate === today ? '오늘' : formatDate(studyDate)}{' '}
                      {Number(endPage) - completed}쪽 읽었어요
                    </p>
                  )}
                {compact && (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-expanded={expanded}
                    onClick={() => setExpanded(!expanded)}
                    className="justify-start sm:col-span-2"
                  >
                    {expanded
                      ? '추가 입력 접기'
                      : '추가 입력 · 날짜, 시간, 메모, 복습'}
                  </Button>
                )}
                <label
                  className={
                    compact && !expanded ? 'hidden' : 'space-y-2 text-sm'
                  }
                >
                  <span>학습 날짜</span>
                  <Input
                    type="date"
                    max={today}
                    required
                    value={studyDate}
                    onChange={(e) => setStudyDate(e.target.value)}
                  />
                </label>
                <label
                  className={
                    compact && !expanded ? 'hidden' : 'space-y-2 text-sm'
                  }
                >
                  <span>학습 시간 (분, 선택)</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={1440}
                    step={1}
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </label>
              </div>
              <label
                className={
                  compact && !expanded ? 'hidden' : 'block space-y-2 text-sm'
                }
              >
                <span>메모 (선택)</span>
                <Input
                  maxLength={2000}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </label>
              <p
                className={
                  compact && !expanded
                    ? 'hidden'
                    : 'text-xs text-muted-foreground'
                }
              >
                학습 날짜는 {plan.timezone} 기준이며 미래 날짜는 기록할 수
                없어요.
              </p>
            </>
          )}
          <div
            className={
              compact
                ? 'sticky bottom-0 bg-surface pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]'
                : undefined
            }
          >
            <Button
              type="submit"
              className={compact ? 'min-h-12 w-full text-base' : undefined}
            >
              {busy
                ? '저장 중…'
                : kind === 'REPLAN'
                  ? '일정 다시 조정하기'
                  : kind === 'CORRECTION' &&
                      endPage !== '' &&
                      Number(endPage) === (latest?.start_page ?? 1) - 1
                    ? '기록 무효 처리하기'
                    : '기록 저장하기'}
            </Button>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {ambiguous && (
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            같은 요청으로 저장 결과 확인
          </Button>
        )}
        {(ambiguous || stale) && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onSaved}
          >
            최신 기록 불러오기
          </Button>
        )}
      </form>
      {result && !onResult && <ProgressResult result={result} />}
    </Card>
  );
}
