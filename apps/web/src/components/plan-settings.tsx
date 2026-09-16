'use client';

import { useState, type FormEvent } from 'react';
import type { Plan, Resource } from '@paceon/shared';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { formatDate } from '@/lib/planning';
import type { ProgressSummary } from './progress-form';

/**
 * 계획을 언제든 고칠 수 있게 모아 둔 카드.
 * 하루 분량·방식·목표 날짜는 기존 재조정 경로를 그대로 쓰고,
 * 일시 정지와 보관은 계획과 자료의 상태만 바꾼다.
 */
export function PlanSettings({
  book,
  plan,
  onSaved,
  onResult,
}: {
  book: Resource;
  plan: Plan;
  onSaved: () => void;
  /** 저장 결과는 부모가 보여 준다. 이 카드는 값이 바뀌면 새 값으로 다시 그려진다. */
  onResult: (result: ProgressSummary) => void;
}) {
  const { apiFetch } = useAuth();
  const [mode, setMode] = useState(plan.mode);
  const [dailyPages, setDailyPages] = useState(
    String(plan.preferred_daily_workload ?? 20),
  );
  const [targetDate, setTargetDate] = useState(plan.target_date ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const paused = plan.status === 'PAUSED';
  const archived = book.status === 'ARCHIVED';

  // plans를 건드리면 서버가 버전을 올린다. 상태를 바꾼 직후에는 그때 받은 버전을 쓴다.
  async function replan(planVersion = plan.version): Promise<ProgressSummary> {
    const response = await apiFetch(
      `/api/resources/books/${book.id}/progress`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'REPLAN',
          idempotencyKey: crypto.randomUUID(),
          planId: plan.id,
          expectedPlanVersion: planVersion,
          expectedProgressVersion: book.progress_version,
          mode,
          ...(mode !== 'DEADLINE' ? { dailyPages: Number(dailyPages) } : {}),
          targetDate: targetDate || null,
        }),
      },
    );
    const body = await response.json();
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? '진도나 계획이 다른 곳에서 바뀌었어요. 최신 정보를 불러온 뒤 다시 바꿔 주세요.'
          : (body.error ??
            '계획을 바꾸지 못했어요. 분량과 목표 날짜를 확인해 주세요.'),
      );
    return { ...(body as ProgressSummary), title: '계획을 다시 나눴어요' };
  }

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function setPlanStatus(
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<{ planVersion: number }> {
    const response = await apiFetch(`/api/resources/books/${book.id}/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error ?? '계획 상태를 바꾸지 못했어요.');
    return body as { planVersion: number };
  }

  async function setBookStatus(status: 'ACTIVE' | 'ARCHIVED') {
    const response = await apiFetch(`/api/resources/books/${book.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '보관 상태를 바꾸지 못했어요.');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      onResult(await replan());
      onSaved();
    });
  }

  return (
    <Card className="space-y-5 p-4 md:p-6" id="plan-settings">
      <div>
        <h2 className="text-lg font-semibold">계획 수정</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          생활이 바뀌면 언제든 고칠 수 있어요. 지금까지의 기록은 그대로 남아요.
        </p>
      </div>
      {book.replan_required && (
        <p className="rounded-lg bg-warning-soft p-3 text-sm">
          지난번 조정이 지금 설정으로는 어려웠어요. 하루 분량을 줄이거나 목표
          날짜를 늦춘 뒤 다시 나눠 주세요.
        </p>
      )}
      {archived ? (
        <div className="space-y-3">
          <p className="text-sm">
            보관한 책이에요. 오늘과 캘린더에는 나오지 않아요.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await setBookStatus('ACTIVE');
                onSaved();
              })
            }
          >
            {busy ? '되돌리는 중…' : '보관 해제'}
          </Button>
        </div>
      ) : (
        <>
          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={busy || paused} className="space-y-4">
              <legend className="sr-only">분량과 목표 날짜</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span>조정 방식</span>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
                    value={mode}
                    onChange={(event) =>
                      setMode(event.target.value as Plan['mode'])
                    }
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
                      inputMode="numeric"
                      min={1}
                      max={10000000}
                      step={1}
                      required
                      value={dailyPages}
                      onChange={(event) => setDailyPages(event.target.value)}
                    />
                  </label>
                )}
                <label className="space-y-2 text-sm">
                  <span>
                    목표 완독 날짜 {mode !== 'DEADLINE' && '(선택)'}
                  </span>
                  <Input
                    type="date"
                    required={mode === 'DEADLINE'}
                    value={targetDate}
                    onChange={(event) => setTargetDate(event.target.value)}
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                학습 가능한 요일과 시간은 다른 책과 함께 쓰므로 여기서는 바꾸지
                않아요. 오늘까지의 일정과 읽은 기록은 그대로 두고 내일 이후만
                다시 나눠요.
              </p>
            </fieldset>
            <Button type="submit" disabled={busy || paused}>
              {busy ? '다시 나누는 중…' : '분량 바꾸고 다시 나누기'}
            </Button>
          </form>
          <div className="space-y-3 border-t border-border pt-5">
            <h3 className="text-sm font-medium">
              {paused ? '멈춰 둔 계획' : '잠시 쉬어 가기'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {paused
                ? '이 책의 일정은 오늘과 캘린더에 나오지 않아요. 다시 시작하면 남은 분량을 오늘 이후로 나눠요.'
                : '멈추면 이 책의 일정만 오늘과 캘린더에서 빠져요. 다른 책의 일정은 그대로예요.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (paused) {
                      const { planVersion } = await setPlanStatus('ACTIVE');
                      // 멈춘 사이 지나간 날이 있으므로 남은 분량을 다시 나눈다.
                      // 실패해도 계획은 살아 있고 오늘 화면이 한 번 더 시도한다.
                      try {
                        onResult(await replan(planVersion));
                      } catch {
                        setError(
                          '계획을 다시 시작했어요. 남은 분량 조정은 오늘 화면에서 이어서 확인해 주세요.',
                        );
                      }
                    } else await setPlanStatus('PAUSED');
                    onSaved();
                  })
                }
              >
                {paused ? '계획 다시 시작' : '계획 일시 정지'}
              </Button>
              {confirming ? (
                <div
                  role="alert"
                  className="w-full space-y-2 rounded-lg bg-warning-soft p-3 text-sm"
                >
                  <p>
                    보관하면 서재의 보관 목록으로 옮기고 계획을 멈춰요. 읽은
                    기록과 통계는 그대로 남고, 언제든 되돌릴 수 있어요.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await setBookStatus('ARCHIVED');
                          setConfirming(false);
                          onSaved();
                        })
                      }
                    >
                      {busy ? '보관하는 중…' : '보관하기'}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirming(false)}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  서재에서 보관하기
                </Button>
              )}
            </div>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {plan.forecast_date && !paused && !archived && (
        <p className="text-xs text-muted-foreground">
          지금 계획의 예상 완독 · {formatDate(plan.forecast_date, true)}
        </p>
      )}
    </Card>
  );
}
