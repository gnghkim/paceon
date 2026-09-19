'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, ChevronDown, ExternalLink, RotateCcw } from 'lucide-react';
import { useAuth } from './auth-provider';
import { StartReadingButton, useReadingTimer } from './reading-timer';
import { MATERIAL_CHANGED, useUnitRecord } from './unit-record';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/planning';
import { WORKSPACE_CHANGED } from '@/lib/quick-record';
import type { MaterialDetail as Detail, MaterialUnit } from '@/lib/unit-materials-api';
import type { RecallNote } from '@/lib/recall-api';
import { findStall } from '@/lib/unit-progress';

/**
 * 챕터로 공부하는 자료 하나. 진도, 계획, 챕터 목록, 그리고 챕터마다 남긴 공부 내용.
 *
 * 같은 기록을 두 방향으로 묶어 본다. 챕터별로 보면 "이 챕터에서 무엇을 했나"가,
 * 날짜별로 보면 "그날 무엇을 했나"가 보인다.
 */
export function MaterialDetail({ id }: { id: string }) {
  const { apiFetch } = useAuth();
  const openRecord = useUnitRecord();
  const notice = useSearchParams().get('notice');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [recalls, setRecalls] = useState<RecallNote[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'UNITS' | 'DAYS'>('UNITS');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const options = { cache: 'no-store' as const, ...(signal ? { signal } : {}) };
        const [main, notes] = await Promise.all([
          apiFetch(`/api/resources/materials/${id}`, options),
          apiFetch(`/api/learning/recall?resourceId=${id}`, options),
        ]);
        const body = await main.json();
        if (!main.ok) throw new Error(body.error ?? '자료를 불러오지 못했어요.');
        setDetail(body as Detail);
        if (notes.ok) setRecalls(((await notes.json()) as { notes: RecallNote[] }).notes);
        setError('');
      } catch (cause) {
        if (!signal?.aborted) setError((cause as Error).message);
      }
    },
    [apiFetch, id],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    const refresh = () => void load();
    window.addEventListener(MATERIAL_CHANGED, refresh);
    return () => {
      clearTimeout(timer);
      controller.abort();
      window.removeEventListener(MATERIAL_CHANGED, refresh);
    };
  }, [load]);

  async function act(path: string, body: unknown, method = 'POST') {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/resources/materials/${id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const problem = await response.json().catch(() => ({}));
        setError(problem.error ?? '처리하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      await load();
      window.dispatchEvent(new Event(WORKSPACE_CHANGED));
    } catch {
      setError('연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (!detail)
    return error ? (
      <div className="mx-auto max-w-3xl space-y-4">
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
          {error}
        </p>
        <Button onClick={() => void load()}>다시 불러오기</Button>
      </div>
    ) : (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );

  const { material, plan, progress, units, today } = detail;
  const label = material.unit_label ?? '챕터';
  const leaves = units.filter((unit) => !unit.section);
  const missed = leaves.some((unit) => !unit.done && unit.scheduledOn === null) && plan?.status === 'ACTIVE';
  const course = material.type === 'COURSE';
  const stall = plan?.status === 'ACTIVE' ? findStall(units, today) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/resources" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft size={16} aria-hidden="true" />
          서재
        </Link>
        <p className="text-sm font-medium text-primary">{course ? '강의' : '교재'}</p>
        <h1 className="mt-1 text-2xl font-semibold break-words">{material.title}</h1>
        {material.source_id && /^https?:\/\//.test(material.source_id) && (
          <a
            href={material.source_id}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-sm text-primary underline"
          >
            <ExternalLink size={14} aria-hidden="true" />
            {course ? '강의 열기' : '자료 열기'}
          </a>
        )}
      </header>

      {(notice || error) && (
        <p role="alert" className="rounded-xl bg-warning-soft p-4 text-sm leading-6">
          {error || notice}
        </p>
      )}

      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">진도</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {progress.done}
              <span className="text-base font-normal text-muted-foreground">
                {' '}
                / {progress.total}
                {label}
              </span>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            {plan?.status === 'COMPLETED'
              ? '모두 마쳤어요'
              : plan?.status === 'PAUSED'
                ? '계획을 멈춰 두었어요'
                : plan?.forecast_date
                  ? `예상 완료 ${formatDate(plan.forecast_date, true)}`
                  : '계획이 없어요'}
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
        </div>
        {progress.done < progress.total && plan && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => openRecord({ materialId: id })}>
              공부한 {label} 기록하기
            </Button>
            <StartTimer materialId={id} title={material.title} course={course} />
          </div>
        )}
      </Card>

      <PlanCard
        key={`${plan?.id ?? 'none'}:${plan?.preferred_daily_workload}:${plan?.minutes_per_page}`}
        label={label}
        plan={plan}
        busy={busy}
        needsRefill={missed || material.replan_required}
        onSave={(options) => act('/plan', options)}
        onStatus={(status) => act('', { status }, 'PATCH')}
        onRefill={() => act('/replan', {})}
      />

      {stall && (
        <p role="status" className="rounded-xl bg-warning-soft p-4 text-sm leading-6">
          <span className="font-medium">{stall.title}</span>
          {stall.minutes !== null && `(${stall.minutes}분)`}이(가) {formatDate(stall.scheduledOn, true)}로 밀려 있어요.
          하루에 남는 학습 시간보다 길어서, 다른 계획이 끝나 시간이 날 때까지 기다리는 중이에요.{' '}
          <Link href="/settings" className="text-primary underline">
            설정
          </Link>
          에서 요일별 학습 시간을 늘리거나 다른 계획의 하루 분량을 줄이면 앞당겨져요. 일정과 상관없이 지금 바로 골라서
          공부할 수도 있어요.
        </p>
      )}

      <section aria-labelledby="units-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="units-title" className="text-lg font-semibold">
            공부 내용
          </h2>
          <div className="flex gap-1" role="group" aria-label="보는 방식">
            {(
              [
                ['UNITS', `${label}별`],
                ['DAYS', '날짜별'],
              ] as const
            ).map(([value, text]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={view === value ? 'secondary' : 'ghost'}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {text}
              </Button>
            ))}
          </div>
        </div>
        {view === 'UNITS' ? (
          <ul className="space-y-2">
            {units.map((unit) =>
              unit.section ? (
                <li key={unit.id} className="px-1 pt-4 text-sm font-semibold text-muted-foreground first:pt-0">
                  {unit.title}
                </li>
              ) : (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  today={today}
                  busy={busy}
                  recalls={recalls.filter((note) => note.unitId === unit.id)}
                  canRecord={!!plan}
                  startLabel={course ? '수강 시작' : '학습 시작'}
                  materialId={id}
                  onComplete={() => openRecord({ materialId: id, unitId: unit.id })}
                  onRepeat={() => openRecord({ materialId: id, unitId: unit.id, mode: 'REPEAT' })}
                  onUndo={() =>
                    act('/progress', { kind: 'UNDO', unitId: unit.id, idempotencyKey: crypto.randomUUID() })
                  }
                />
              ),
            )}
          </ul>
        ) : (
          <DayView units={leaves} recalls={recalls} />
        )}
      </section>
    </div>
  );
}

function StartTimer({ materialId, title, course }: { materialId: string; title: string; course: boolean }) {
  const { running } = useReadingTimer();
  if (running?.resourceId === materialId)
    return <p className="self-center text-sm text-primary">시간을 재고 있어요. 위쪽 띠에서 끝낼 수 있어요.</p>;
  // 챕터를 정하지 않고 시작한다. 끝낼 때 무엇을 했는지 고른다.
  return (
    <StartReadingButton
      resourceId={materialId}
      title={title}
      unit={{}}
      label={course ? '수강 시작' : '학습 시작'}
      emphasis="quiet"
    />
  );
}

function UnitRow({
  unit,
  today,
  busy,
  recalls,
  canRecord,
  startLabel,
  materialId,
  onComplete,
  onRepeat,
  onUndo,
}: {
  unit: MaterialUnit;
  today: string;
  busy: boolean;
  recalls: RecallNote[];
  canRecord: boolean;
  startLabel: string;
  materialId: string;
  onComplete: () => void;
  onRepeat: () => void;
  onUndo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasContent = unit.studies.length > 0 || recalls.length > 0;
  return (
    <li className={cn('rounded-xl border border-border', unit.done ? 'bg-muted/40' : 'bg-card')}>
      <div className="flex flex-wrap items-center gap-3 p-4">
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-xs',
            unit.done ? 'bg-success-soft text-success' : 'border border-border text-muted-foreground',
          )}
          aria-hidden="true"
        >
          {unit.done ? <Check size={16} /> : unit.sequence}
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-expanded={open}
          disabled={!hasContent}
          onClick={() => setOpen(!open)}
        >
          <span className={cn('block break-words font-medium', unit.done && 'text-muted-foreground')}>{unit.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {unit.done
              ? `${formatDate(unit.studies.find((study) => study.kind === 'FIRST')?.studyDate ?? today)}에 공부함`
              : unit.scheduledOn
                ? unit.scheduledOn === today
                  ? '오늘'
                  : `${formatDate(unit.scheduledOn)} 예정`
                : '일정에 없음'}
            {unit.minutes !== null && ` · ${unit.minutes}분`}
            {hasContent && ` · 기록 ${unit.studies.length + recalls.length}개`}
          </span>
        </button>
        {hasContent && (
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        )}
        {canRecord && (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {unit.done ? (
              <>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRepeat}>
                  <RotateCcw size={14} aria-hidden="true" />
                  다시 공부
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onUndo}>
                  완료 취소
                </Button>
              </>
            ) : (
              <>
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onComplete}>
                  공부했어요
                </Button>
                <StartReadingButton
                  resourceId={materialId}
                  title={unit.title}
                  unit={{ id: unit.id }}
                  label={startLabel}
                  emphasis="quiet"
                />
              </>
            )}
          </div>
        )}
      </div>
      {open && hasContent && (
        <div className="space-y-3 border-t border-border px-4 py-3 text-sm">
          {unit.studies.map((study) => (
            <div key={study.id}>
              <p className="text-xs text-muted-foreground">
                {formatDate(study.studyDate)} · {study.kind === 'FIRST' ? '공부함' : '다시 공부함'}
                {study.minutes !== null && ` · ${study.minutes}분`}
              </p>
              {study.memo && <p className="mt-1 whitespace-pre-wrap break-words leading-6">{study.memo}</p>}
            </div>
          ))}
          {recalls.map((note) => (
            <div key={note.id} className="rounded-lg bg-accent/50 p-3">
              <p className="text-xs text-muted-foreground">
                덮고 떠올린 것 · {formatDate(note.createdOn)} · 다음 복습 {formatDate(note.dueOn)}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words leading-6">{note.content}</p>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** 같은 기록을 날짜로 묶어 본다. 최근 날이 먼저다. */
function DayView({ units, recalls }: { units: MaterialUnit[]; recalls: RecallNote[] }) {
  const entries = [
    ...units.flatMap((unit) =>
      unit.studies.map((study) => ({
        key: study.id,
        date: study.studyDate,
        title: unit.title,
        line: `${study.kind === 'FIRST' ? '공부함' : '다시 공부함'}${study.minutes !== null ? ` · ${study.minutes}분` : ''}`,
        text: study.memo,
        recall: false,
      })),
    ),
    ...recalls.map((note) => ({
      key: note.id,
      date: note.createdOn,
      title: units.find((unit) => unit.id === note.unitId)?.title ?? '',
      line: '덮고 떠올린 것',
      text: note.content,
      recall: true,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (!entries.length)
    return (
      <p className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        아직 남긴 기록이 없어요. 공부한 뒤 무엇을 했는지 적어 두면 여기에 날짜별로 모여요.
      </p>
    );
  const days = [...new Set(entries.map((entry) => entry.date))];
  return (
    <div className="space-y-5">
      {days.map((day) => (
        <div key={day}>
          <h3 className="mb-2 text-sm font-semibold">{formatDate(day, true)}</h3>
          <ul className="space-y-2">
            {entries
              .filter((entry) => entry.date === day)
              .map((entry) => (
                <li
                  key={entry.key}
                  className={cn('rounded-xl border border-border p-4 text-sm', entry.recall ? 'bg-accent/50' : 'bg-card')}
                >
                  <p className="font-medium break-words">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{entry.line}</p>
                  {entry.text && <p className="mt-2 whitespace-pre-wrap break-words leading-6">{entry.text}</p>}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function PlanCard({
  label,
  plan,
  busy,
  needsRefill,
  onSave,
  onStatus,
  onRefill,
}: {
  label: string;
  plan: Detail['plan'];
  busy: boolean;
  needsRefill: boolean;
  onSave: (options: { dailyUnits: number; minutesPerUnit: number }) => void;
  onStatus: (status: 'ACTIVE' | 'PAUSED') => void;
  onRefill: () => void;
}) {
  const [editing, setEditing] = useState(!plan);
  const [daily, setDaily] = useState(String(Math.round(Number(plan?.preferred_daily_workload ?? 2))));
  const [minutes, setMinutes] = useState(String(Math.round(Number(plan?.minutes_per_page ?? 30))));
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ dailyUnits: Number(daily), minutesPerUnit: Number(minutes) });
    setEditing(false);
  }
  if (plan?.status === 'COMPLETED') return null;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">계획</h2>
        {plan && !editing && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              수정
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onStatus(plan.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED')}
            >
              {plan.status === 'PAUSED' ? '다시 시작' : '잠시 멈춤'}
            </Button>
          </div>
        )}
      </div>
      {plan && !editing ? (
        <p className="text-sm leading-6 text-muted-foreground">
          하루 {Math.round(Number(plan.preferred_daily_workload))}
          {label}, 길이를 모르는 것은 {Math.round(Number(plan.minutes_per_page))}분으로 보고 담아요. 순서대로 일정을 잡지만
          아무 {label}이나 먼저 공부할 수 있고, 그러면 남은 일정에서 빠져요.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm" htmlFor="plan-daily">
              <span className="font-medium">하루에 몇 {label}</span>
              <Input id="plan-daily" type="number" inputMode="numeric" min={1} max={100} required value={daily} onChange={(event) => setDaily(event.target.value)} />
            </label>
            <label className="block space-y-2 text-sm" htmlFor="plan-minutes">
              <span className="font-medium">길이를 모르는 {label}은 몇 분</span>
              <Input id="plan-minutes" type="number" inputMode="numeric" min={1} max={1440} required value={minutes} onChange={(event) => setMinutes(event.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              {plan ? '바꾸고 다시 담기' : '계획 만들기'}
            </Button>
            {plan && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                취소
              </Button>
            )}
          </div>
        </form>
      )}
      {plan && needsRefill && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-warning-soft p-3 text-sm">
          <p>일정에 담기지 않은 {label}이 있어요. 내일부터 다시 담을까요?</p>
          <Button type="button" size="sm" disabled={busy} onClick={onRefill}>
            다시 담기
          </Button>
        </div>
      )}
    </Card>
  );
}
