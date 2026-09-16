'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CalendarClock, X } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { formatDate } from '@/lib/planning';
import { WORKSPACE_CHANGED } from '@/lib/quick-record';
import {
  CATCH_UP_KEY,
  catchUpKey,
  catchUpTargets,
  readCatchUpMemory,
  type CatchUpTarget,
} from '@/lib/catch-up';
import type { WorkspaceData } from '@/lib/workspace-types';

type Result =
  | { kind: 'moved'; pages: number; titles: string[]; forecast: string | null }
  | { kind: 'blocked'; titles: string[] };

/**
 * 며칠 기록하지 않아 지나간 학습일을 앱을 열 때 한 번 정리한다.
 * 남은 분량을 내일 이후로 다시 나누고, 무엇이 왜 바뀌었는지 한 줄로 알린다.
 * 조정에 실패하면 기존 일정을 그대로 두고 사용자가 직접 설정을 고치도록 안내한다.
 */
export function CatchUpNotice({ data }: { data: WorkspaceData }) {
  const { apiFetch } = useAuth();
  const [result, setResult] = useState<Result | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const running = useRef(false);
  useEffect(() => {
    if (running.current) return;
    const targets = catchUpTargets(data);
    if (!targets.length) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(CATCH_UP_KEY);
    } catch {
      /* 저장소를 못 쓰면 이번 방문에만 정리한다. */
    }
    const memory = readCatchUpMemory(stored, data.today);
    const due = targets.filter((target) => !catchUpKey(memory, target.planId));
    if (!due.length) return;
    running.current = true;
    const controller = new AbortController();
    void (async () => {
      const moved: CatchUpTarget[] = [];
      const blocked: CatchUpTarget[] = [];
      let forecast: string | null = null;
      for (const target of due) {
        const key = catchUpKey(memory, target.planId) ?? crypto.randomUUID();
        memory.keys[target.planId] = key;
        try {
          const response = await apiFetch(
            `/api/resources/books/${target.resourceId}/progress`,
            {
              method: 'POST',
              signal: controller.signal,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                kind: 'REPLAN',
                idempotencyKey: key,
                planId: target.planId,
                expectedPlanVersion: target.expectedPlanVersion,
                expectedProgressVersion: target.expectedProgressVersion,
              }),
            },
          );
          if (!response.ok) {
            // 다른 곳에서 이미 바뀌었거나 일시적인 오류다. 다음 방문에 다시 시도한다.
            delete memory.keys[target.planId];
            continue;
          }
          const summary = await response.json();
          if (summary.replanStatus === 'pending') blocked.push(target);
          else {
            moved.push(target);
            forecast = summary.forecastAfter ?? forecast;
          }
        } catch {
          delete memory.keys[target.planId];
        }
      }
      try {
        localStorage.setItem(CATCH_UP_KEY, JSON.stringify(memory));
      } catch {
        /* 저장하지 못하면 다음 방문에 한 번 더 시도한다. */
      }
      if (controller.signal.aborted) return;
      if (moved.length) {
        setResult({
          kind: 'moved',
          pages: moved.reduce((sum, target) => sum + target.missedPages, 0),
          titles: moved.map((target) => target.title),
          forecast: moved.length === 1 ? forecast : null,
        });
        window.dispatchEvent(new Event(WORKSPACE_CHANGED));
      } else if (blocked.length) {
        setResult({ kind: 'blocked', titles: blocked.map((target) => target.title) });
        window.dispatchEvent(new Event(WORKSPACE_CHANGED));
      }
    })();
    return () => controller.abort();
  }, [apiFetch, data]);
  if (!result || dismissed) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-border bg-accent/60 p-4"
    >
      <CalendarClock size={18} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        {result.kind === 'moved' ? (
          <>
            <p className="font-medium">
              못 읽은 {result.pages}쪽을 앞으로 나눴어요
            </p>
            <p className="mt-1 leading-6 text-muted-foreground">
              {result.titles.join(', ')}
              {result.forecast
                ? ` · 예상 완독 ${formatDate(result.forecast, true)}`
                : ''}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">일정을 다시 나누지 못했어요</p>
            <p className="mt-1 leading-6 text-muted-foreground">
              읽은 기록은 그대로예요. {result.titles.join(', ')}의 하루 분량이나 목표
              날짜를 확인해 주세요.
            </p>
            <Button asChild variant="outline" className="mt-3">
              <Link href="/resources">서재에서 계획 고치기</Link>
            </Button>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label="안내 닫기"
        onClick={() => setDismissed(true)}
        className="flex size-11 shrink-0 items-center justify-center text-muted-foreground"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
