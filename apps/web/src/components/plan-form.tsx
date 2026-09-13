'use client';

import { useRef, useState, type FormEvent } from 'react';
import type { Resource } from '@paceon/shared';
import { toStudyDate, type ScheduleResult } from '@paceon/scheduler';
import type { WorkspaceData } from '@/lib/workspace-types';
import { formatDate, type PlanOptions } from '@/lib/planning';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
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
  const [timezone, setTimezone] = useState(() => initialTimezone(data));
  const [startDate, setStartDate] = useState(
    () => studyToday(initialTimezone(data)) ?? data.today,
  );
  const startEdited = useRef(false);
  const [targetDate, setTargetDate] = useState('');
  const [dailyPages, setDailyPages] = useState('20');
  const [minutesPerPage, setMinutesPerPage] = useState('1');
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
  const effectiveTimezone = sharedAvailability
    ? data.timezone
    : timezone.trim();
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
                onChange={(e) => {
                  startEdited.current = true;
                  setStartDate(e.target.value);
                }}
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
            <label className="block space-y-2 text-sm font-medium">
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
          </div>
          <p className="text-xs text-muted-foreground">
            처음에는 한 페이지당 1분으로 설정했어요. 책의 난이도와 읽는 속도에
            맞게 바꿔 주세요.
          </p>
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
            {sharedAvailability ? (
              <p className="text-xs text-muted-foreground">
                시간대 · {data.timezone}
              </p>
            ) : (
              <div className="space-y-2">
                <label className="block max-w-sm space-y-2 text-sm">
                  <span>학습 시간대</span>
                  <Input
                    list="plan-timezones"
                    required
                    maxLength={100}
                    value={timezone}
                    aria-invalid={!today}
                    aria-describedby="plan-timezone-help"
                    onChange={(e) => {
                      const value = e.target.value;
                      setTimezone(value);
                      const nextToday = studyToday(value.trim());
                      if (!startEdited.current && nextToday)
                        setStartDate(nextToday);
                    }}
                  />
                </label>
                <datalist id="plan-timezones">
                  {Array.from(
                    new Set([
                      initialTimezone(data),
                      data.timezone,
                      'Asia/Seoul',
                      'Asia/Tokyo',
                      'Asia/Shanghai',
                      'Asia/Singapore',
                      'Europe/London',
                      'Europe/Paris',
                      'America/New_York',
                      'America/Chicago',
                      'America/Los_Angeles',
                      'Pacific/Honolulu',
                      'Australia/Sydney',
                      'UTC',
                    ]),
                  ).map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                <p
                  id="plan-timezone-help"
                  className={`text-xs ${today ? 'text-muted-foreground' : 'text-destructive'}`}
                >
                  {today
                    ? `선택한 시간대의 오늘은 ${formatDate(today, true)}입니다. 다른 책에도 같은 시간대를 사용합니다.`
                    : '목록에서 선택하거나 올바른 IANA 시간대를 입력해 주세요. 예: Asia/Seoul'}
                </p>
              </div>
            )}
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
