'use client';

import { useState, type FormEvent } from 'react';
import { useAuth } from './auth-provider';
import { useWorkspace, WorkspaceError } from './workspace-data';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';

/**
 * 하루 영어 학습 목표 시간. 비워 두면 목표 없이 쌓인 시간만 보여 준다.
 * 목표는 격려용이며 계획 계산이나 통계 집계에 쓰지 않는다.
 */
export function LearningGoalForm() {
  const { apiFetch } = useAuth();
  const { data, error, reload } = useWorkspace();

  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <Skeleton className="h-28 w-full" />;
  return (
    // 이 폼이 유일한 쓰기 주체다. 저장 뒤 다시 불러온 값으로 리마운트하면
    // 방금 띄운 확인 문구가 사라지므로 처음 값만 받아 쓴다.
    <GoalFields
      initial={data.dailyLearningMinutes}
      save={async (minutes) => {
        const response = await apiFetch('/api/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dailyLearningMinutes: minutes }),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? '목표를 저장하지 못했어요. 다시 시도해 주세요.');
        reload();
      }}
    />
  );
}

function GoalFields({
  initial,
  save,
}: {
  initial: number | null;
  save: (minutes: number | null) => Promise<void>;
}) {
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    setFailure('');
    try {
      await save(value.trim() === '' ? null : Number(value));
      setMessage(value.trim() === '' ? '목표를 지웠어요.' : '목표를 저장했어요.');
    } catch (cause) {
      setFailure((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-card p-5">
      <label className="block space-y-2 text-sm" htmlFor="daily-learning-minutes">
        <span className="font-medium">하루 영어 학습 목표 (분)</span>
        <Input
          id="daily-learning-minutes"
          type="number"
          inputMode="numeric"
          min={1}
          max={1440}
          step={1}
          placeholder="예: 10"
          className="max-w-40"
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <p className="text-xs leading-5 text-muted-foreground">
        오늘 화면에 쌓인 시간과 함께 보여 줘요. 비워 두면 목표 없이 시간만 보여 주고, 목표를
        못 채워도 알리지 않아요.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? '저장 중…' : '목표 저장'}
        </Button>
        {value.trim() !== '' && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => setValue('')}
          >
            목표 없이 두기
          </Button>
        )}
      </div>
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
    </form>
  );
}
