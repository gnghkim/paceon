'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { AvailabilityRule } from '@paceon/shared';
import { useAuth } from './auth-provider';
import { useWorkspace, WorkspaceError } from './workspace-data';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

type Conflict = { resourceId: string; title: string; code: string };
const conflictMessages: Record<string, string> = {
  TIME_CAPACITY: '하루에 넣을 수 있는 분량을 넘겨요.',
  DEADLINE_CAPACITY: '목표 날짜까지 다 읽기 어려워요.',
  NO_AVAILABILITY: '학습할 요일이 없어요.',
  HORIZON_EXCEEDED: '이 속도로는 끝나는 날이 너무 멀어요.',
};

/**
 * 주간 학습 가능 시간. 여러 책이 함께 쓰므로 바꾸면 진행 중인 계획을 모두 다시 나눈다.
 * 한 권이라도 들어가지 않으면 아무것도 바꾸지 않고 어느 책이 걸리는지 알린다.
 */
export function AvailabilityForm() {
  const { data, error, reload } = useWorkspace();
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <Skeleton className="h-64 w-full" />;
  if (!data.availability.length)
    return (
      <p className="rounded-xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
        아직 학습 시간을 정하지 않았어요. 첫 책의 계획을 만들 때 고른 요일과 시간이 여기에
        나와요.
      </p>
    );
  return <Fields saved={data.availability} timezone={data.timezone} />;
}

function Fields({
  saved,
  timezone,
}: {
  saved: readonly AvailabilityRule[];
  timezone: string;
}) {
  const { apiFetch } = useAuth();
  const [minutes, setMinutes] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      Array.from({ length: 7 }, (_, index) => {
        const rule = saved.find((item) => item.iso_weekday === index + 1);
        return [index + 1, rule ? String(rule.available_minutes) : ''];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const chosen = Object.entries(minutes)
    .filter(([, value]) => value.trim() !== '' && Number(value) > 0)
    .map(([isoWeekday, value]) => ({
      isoWeekday: Number(isoWeekday),
      availableMinutes: Number(value),
    }));
  const weekTotal = chosen.reduce((sum, item) => sum + item.availableMinutes, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setFailure('');
    setConflicts([]);
    try {
      const response = await apiFetch('/api/availability', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: chosen }),
      });
      const body = await response.json();
      if (!response.ok) {
        setFailure(body.error ?? '학습 시간을 바꾸지 못했어요.');
        setConflicts(body.conflicts ?? []);
        return;
      }
      setConflicts(body.needsAttention ?? []);
      setMessage(
        body.rescheduled?.length
          ? `학습 시간을 바꾸고 ${body.rescheduled.join(', ')}의 일정을 다시 나눴어요.`
          : '학습 시간을 저장했어요.',
      );
    } catch {
      setFailure('연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-xl border border-border bg-card p-5"
    >
      <fieldset disabled={busy} className="space-y-3">
        <legend className="text-sm font-medium">요일마다 공부할 시간 (분)</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {weekdays.map((label, index) => (
            <label key={label} className="space-y-1.5 text-sm">
              <span className="block text-muted-foreground">{label}요일</span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={1440}
                step={1}
                placeholder="쉬는 날"
                value={minutes[index + 1] ?? ''}
                onChange={(event) =>
                  setMinutes((previous) => ({
                    ...previous,
                    [index + 1]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs leading-5 text-muted-foreground">
        비워 두면 그 요일은 쉬어요. 이 시간은 모든 책이 나눠 쓰므로, 바꾸면 진행 중인 계획을
        모두 다시 나눠요. 오늘까지의 일정과 읽은 기록은 그대로 두고 내일 이후만 바꿔요. 시간대
        {' '}
        {timezone}는 여기서 바꾸지 않아요.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !chosen.length}>
          {busy ? '다시 나누는 중…' : '학습 시간 저장'}
        </Button>
        <span className="text-sm text-muted-foreground">
          한 주에 {Math.floor(weekTotal / 60)}시간 {weekTotal % 60}분
        </span>
      </div>
      {!chosen.length && (
        <p className="text-sm text-muted-foreground">
          학습할 요일을 하나 이상 정해 주세요.
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-primary">
          {message}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      {conflicts.length > 0 && (
        <ul className="space-y-2 rounded-lg bg-warning-soft p-3 text-sm">
          {conflicts.map((conflict) => (
            <li key={conflict.resourceId}>
              <Link
                href={`/resources/${conflict.resourceId}`}
                className="font-medium underline"
              >
                {conflict.title}
              </Link>
              {' · '}
              {conflict.code === 'REPLAN_FAILED'
                ? '일정을 다시 나누지 못했어요. 상세에서 계획을 확인해 주세요.'
                : (conflictMessages[conflict.code] ??
                  '지금 설정으로는 넣기 어려워요.')}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
