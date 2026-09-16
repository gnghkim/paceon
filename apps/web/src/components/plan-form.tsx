'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Resource } from '@paceon/shared';
import { toStudyDate, type ScheduleResult } from '@paceon/scheduler';
import type { WorkspaceData } from '@/lib/workspace-types';
import { formatDate, type PlanOptions } from '@/lib/planning';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
/** 첫 계획에서 고르기 쉬운 속도. 정확한 값은 기록이 쌓인 뒤 엔진이 다시 추정한다. */
const speedChoices: readonly (readonly [string, string])[] = [
  ['빠르게 · 30초', '0.5'],
  ['보통 · 1분', '1'],
  ['천천히 · 2분', '2'],
];

/** 최근 90일 동안 실제로 기록된 분/쪽. 표본이 없으면 null이다. */
function useObservedSpeed() {
  const { apiFetch } = useAuth();
  const [observed, setObserved] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/api/statistics', { signal: controller.signal, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { summary?: { minutesPerPage: number | null } } | null) => {
        const value = body?.summary?.minutesPerPage ?? null;
        if (!controller.signal.aborted && value !== null && value >= 0.1 && value <= 1440)
          setObserved(Math.round(value * 100) / 100);
      })
      // 참고용 제안이다. 못 받으면 고른 속도를 그대로 쓴다.
      .catch(() => {});
    return () => controller.abort();
  }, [apiFetch]);
  return observed;
}
function studyToday(timezone: string): string | null {
  try {
    return toStudyDate(new Date().toISOString(), timezone);
  } catch {
    return null;
  }
}
function initialTimezone(data: WorkspaceData): string {
  if (data.availability.length) return data.timezone;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || data.timezone;
  } catch {
    return data.timezone;
  }
}
export function PlanForm({
  book,
  data,
  onSaved,
}: {
  book: Resource;
  data: WorkspaceData;
  onSaved: () => void;
}) {
  const { apiFetch } = useAuth();
  const [mode, setMode] = useState<PlanOptions['mode']>('PACE');
  // 시간대는 브라우저에서 읽어 그대로 쓴다. 첫 계획을 세우며 고를 일이 아니고,
  // 계획마다 저장되어 학습일 계산에 쓰이므로 나중에 바꾸는 것도 별도 작업이다.
  const timezone = initialTimezone(data);
  const [startDate, setStartDate] = useState(
    () => studyToday(initialTimezone(data)) ?? data.today,
  );
  const [targetDate, setTargetDate] = useState('');
  const [dailyPages, setDailyPages] = useState('20');
  const [minutesPerPage, setMinutesPerPage] = useState('1');
  const [customSpeed, setCustomSpeed] = useState(false);
  const observed = useObservedSpeed();
  const [days, setDays] = useState([1, 2, 3, 4, 5]);
  const [minutes, setMinutes] = useState('60');
  const [preview, setPreview] = useState<{
    key: string;
    schedule: ScheduleResult;
  } | null>(null);
  const [busy, setBusy] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState('');
  const requestRef = useRef(false);
  const sharedAvailability = data.availability.length > 0;
  const effectiveTimezone = sharedAvailability ? data.timezone : timezone;
  const today = studyToday(effectiveTimezone);
  const options: PlanOptions = {
    mode,
    startDate,
    timezone: effectiveTimezone,
    minutesPerPage: Number(minutesPerPage),
    ...(targetDate ? { targetDate } : {}),
    ...(mode !== 'DEADLINE' ? { dailyPages: Number(dailyPages) } : {}),
    availability: sharedAvailability
      ? data.availability.map((rule) => ({
          isoWeekday: rule.iso_weekday,
          availableMinutes: rule.available_minutes,
        }))
      : days.map((isoWeekday) => ({
          isoWeekday,
          availableMinutes: Number(minutes),
        })),
  };
  const key = JSON.stringify(options);
  const currentPreview = preview?.key === key ? preview.schedule : null;
  async function request(isPreview: boolean) {
    if (
      requestRef.current ||
      (!isPreview && (!currentPreview || currentPreview.status === 'conflict'))
    )
      return;
    if (!today) {
      setError('올바른 시간대를 선택해 주세요. 예: Asia/Seoul');
      return;
    }
    if (startDate < today) {
      setError('선택한 시간대의 오늘 이후로 시작 날짜를 정해 주세요.');
      return;
    }
    if (!options.availability.length) {
      setError('학습할 요일을 하나 이상 선택해 주세요.');
      return;
    }
    requestRef.current = true;
    setBusy(isPreview ? 'preview' : 'save');
    setError('');
    if (isPreview) setPreview(null);
    try {
      const response = await apiFetch(`/api/resources/books/${book.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ options, preview: isPreview }),
      });
      const payload = (await response.json()) as {
        error?: string;
        schedule?: ScheduleResult;
      };
      if (!response.ok) {
        if (payload.schedule) setPreview({ key, schedule: payload.schedule });
        setError(
          payload.error ||
            '계획을 만들지 못했어요. 날짜와 학습 시간을 확인해 주세요.',
        );
        if (!isPreview) setPreview(null);
        return;
      }
      if (isPreview && payload.schedule)
        setPreview({ key, schedule: payload.schedule });
      else if (!isPreview) onSaved();
    } catch {
      setError(
        isPreview
          ? '계획을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'
          : '저장 결과를 확인하지 못했어요. 페이지를 새로고침해 계획 저장 여부를 먼저 확인해 주세요.',
      );
      setPreview(null);
    } finally {
      requestRef.current = false;
      setBusy(null);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void request(true);
  }
  return (
    <Card className="p-4 md:p-6">
      <h2 className="text-lg font-semibold">나에게 맞는 독서 계획</h2>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">
        남은 {(book.total_pages ?? 0) - book.initial_completed_workload}쪽을
        읽을 시간을 나눠 보세요.
      </p>
      <form onSubmit={submit} className="space-y-6">
        <fieldset disabled={busy !== null} className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['PACE', '하루 분량 유지', '정해진 분량을 꾸준히 읽어요.'],
              [
                'DEADLINE',
                '목표 날짜에 맞추기',
                '완독 날짜까지 분량을 나눠요.',
              ],
              [
                'BALANCED',
                '균형 조정',
                '하루 분량과 목표 날짜를 함께 고려해요.',
              ],
            ].map(([value, label, description]) => (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 ${mode === value ? 'border-primary bg-accent' : 'border-border'}`}
              >
                <input
                  type="radio"
                  name="planMode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value as PlanOptions['mode'])}
                  className="mt-1 size-4 accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium">
              <span>시작 날짜</span>
              <Input
                type="date"
                min={today ?? undefined}
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium">
              <span>목표 완독 날짜 {mode !== 'DEADLINE' && '(선택)'}</span>
              <Input
                type="date"
                min={startDate}
                required={mode === 'DEADLINE'}
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </label>
            {mode !== 'DEADLINE' && (
              <label className="block space-y-2 text-sm font-medium">
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
          </div>
          <div className="space-y-3">
            <span className="block text-sm font-medium">읽는 속도</span>
            <div className="flex flex-wrap gap-2">
              {speedChoices.map(([label, value]) => (
                <Button
                  key={value}
                  type="button"
                  variant={
                    !customSpeed && minutesPerPage === value
                      ? 'secondary'
                      : 'outline'
                  }
                  aria-pressed={!customSpeed && minutesPerPage === value}
                  onClick={() => {
                    setCustomSpeed(false);
                    setMinutesPerPage(value);
                  }}
                >
                  {label}
                </Button>
              ))}
              <Button
                type="button"
                variant={customSpeed ? 'secondary' : 'outline'}
                aria-pressed={customSpeed}
                onClick={() => setCustomSpeed(true)}
              >
                직접 입력
              </Button>
            </div>
            {customSpeed && (
              <label className="block max-w-xs space-y-2 text-sm">
                <span>한 페이지당 예상 시간 (분)</span>
                <Input
                  type="number"
                  min={0.1}
                  max={1440}
                  step="0.001"
                  required
                  value={minutesPerPage}
                  onChange={(e) => setMinutesPerPage(e.target.value)}
                />
              </label>
            )}
            <p className="text-xs leading-5 text-muted-foreground">
              한 페이지에 약 {minutesPerPage}분으로 계산해요. 정확하지 않아도
              괜찮아요. 기록이 쌓이면 실제 속도로 일정을 다시 나눠요.
              {observed !== null && (
                <>
                  {' '}
                  최근 기록으로는 {observed}분/쪽이에요.{' '}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setCustomSpeed(true);
                      setMinutesPerPage(String(observed));
                    }}
                  >
                    이 속도 쓰기
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-medium">학습 가능한 시간</h3>
            {sharedAvailability ? (
              <>
                <p className="text-sm text-muted-foreground">
                  다른 책과 함께 쓰는 기존 학습 시간을 적용합니다.
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.availability.map((rule) => (
                    <span
                      key={rule.iso_weekday}
                      className="rounded-md bg-muted px-3 py-2 text-sm"
                    >
                      {weekdays[rule.iso_weekday - 1]}요일{' '}
                      {rule.available_minutes}분
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {weekdays.map((day, index) => (
                    <label
                      key={day}
                      className={`flex min-h-10 items-center gap-2 rounded-md border px-3 ${days.includes(index + 1) ? 'border-primary bg-accent' : 'border-border'}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={days.includes(index + 1)}
                        onChange={(e) =>
                          setDays((previous) =>
                            e.target.checked
                              ? [...previous, index + 1].sort()
                              : previous.filter((d) => d !== index + 1),
                          )
                        }
                      />
                      {day}
                    </label>
                  ))}
                </div>
                <label className="block max-w-xs space-y-2 text-sm">
                  <span>선택한 요일마다 학습할 시간 (분)</span>
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    required
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  이 시간은 앞으로 추가할 책과 함께 사용합니다.
                </p>
              </>
            )}
            <p
              id="plan-timezone-help"
              className={`text-xs ${today ? 'text-muted-foreground' : 'text-destructive'}`}
            >
              {today
                ? `시간대 · ${effectiveTimezone} · 이 시간대의 오늘은 ${formatDate(today, true)}입니다.`
                : '시간대를 읽지 못했어요. 기기의 시간대 설정을 확인해 주세요.'}
            </p>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" variant="outline" disabled={busy !== null}>
          {busy === 'preview' ? '일정을 계산하는 중…' : '일정 미리보기'}
        </Button>
      </form>
      {preview && !currentPreview && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          설정이 바뀌었어요. 일정을 다시 미리 본 뒤 저장해 주세요.
        </p>
      )}
      {currentPreview && currentPreview.status !== 'conflict' && (
        <section
          className="mt-6 space-y-4 rounded-lg bg-accent/50 p-4"
          aria-label="계획 미리보기"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">예상 완독</p>
              <p className="mt-1 text-xl font-semibold">
                {currentPreview.status === 'completed'
                  ? '이미 완독했어요'
                  : formatDate(currentPreview.forecastDate, true)}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              총 {currentPreview.sessions.length}회 학습
            </p>
          </div>
          {targetDate && (
            <p className="text-sm">
              목표 날짜 · {formatDate(targetDate, true)}
              {currentPreview.forecastDate &&
              currentPreview.forecastDate > targetDate
                ? ' · 목표보다 늦게 끝나는 일정이에요.'
                : ''}
            </p>
          )}
          <ul className="divide-y divide-border">
            {currentPreview.sessions.slice(0, 5).map((session) => (
              <li
                key={session.studyDate}
                className="flex flex-wrap justify-between gap-2 py-3 text-sm"
              >
                <span>{formatDate(session.studyDate)}</span>
                <span>
                  {session.startPage}–{session.endPage}쪽 · 약{' '}
                  {Math.ceil(session.estimatedMinutes)}분
                </span>
              </li>
            ))}
          </ul>
          {currentPreview.sessions.length > 5 && (
            <p className="text-xs text-muted-foreground">
              첫 5개 일정을 표시했어요. 저장하면 캘린더에서 이어지는 일정을
              확인할 수 있어요.
            </p>
          )}
          <Button disabled={busy !== null} onClick={() => void request(false)}>
            {busy === 'save' ? '계획 저장 중…' : '이 계획으로 시작하기'}
          </Button>
        </section>
      )}
    </Card>
  );
}
