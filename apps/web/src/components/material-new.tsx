'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { cn } from '@/lib/utils';
import {
  MAX_UNITS,
  generateOutline,
  parseOutline,
  suggestDefaultMinutes,
  summarizeOutline,
  type OutlineItem,
} from '@/lib/unit-outline';

type Kind = 'TEXTBOOK' | 'COURSE';
const labelChoices: Record<Kind, string[]> = {
  TEXTBOOK: ['Unit', 'Chapter', 'Lesson', '장', '과'],
  COURSE: ['강', '회차', 'Lecture'],
};

/**
 * 챕터로 공부하는 자료를 등록한다. 교재의 Unit, 강의의 강.
 *
 * 등록이 귀찮으면 아무도 쓰지 않는다. 그래서 목차를 손으로 치게 하지 않는다.
 * 개수만 넣어 한 번에 만들거나, 강의 페이지의 커리큘럼을 복사해 붙이면 뽑아 준다.
 * 뽑은 결과는 저장하기 전에 보여 주고, 잘못 들어온 줄은 지울 수 있다.
 */
export function MaterialNew() {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('TEXTBOOK');
  const [title, setTitle] = useState('');
  const [unitLabel, setUnitLabel] = useState('Unit');
  const [sourceUrl, setSourceUrl] = useState('');
  const [method, setMethod] = useState<'COUNT' | 'PASTE'>('COUNT');
  const [count, setCount] = useState('');
  const [pasted, setPasted] = useState('');
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [dailyUnits, setDailyUnits] = useState('2');
  const [minutesPerUnit, setMinutesPerUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const parsed = useMemo<OutlineItem[]>(
    () => (method === 'COUNT' ? generateOutline(unitLabel, Number(count)) : parseOutline(pasted)),
    [method, unitLabel, count, pasted],
  );
  // 지운 줄을 뺀 뒤, 딸린 챕터가 없어진 묶음 제목도 함께 뺀다.
  const outline = useMemo(() => {
    const kept = parsed.filter((_, index) => !removed.has(index));
    return kept.filter((item, index) => !item.section || (kept[index + 1] && !kept[index + 1]!.section));
  }, [parsed, removed]);
  const summary = summarizeOutline(outline);
  const suggested = suggestDefaultMinutes(outline);
  const perUnit = minutesPerUnit === '' ? (suggested ?? 30) : Number(minutesPerUnit);
  const totalMinutes = summary.knownMinutes + summary.untimed * (Number.isFinite(perUnit) ? perUnit : 0);

  function chooseKind(next: Kind) {
    setKind(next);
    setUnitLabel(labelChoices[next][0]!);
    setMethod(next === 'COURSE' ? 'PASTE' : 'COUNT');
    setRemoved(new Set());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !summary.units) return;
    setBusy(true);
    setError('');
    try {
      const created = await apiFetch('/api/resources/materials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          kind,
          unitLabel: unitLabel.trim(),
          ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
          units: outline,
        }),
      });
      const body = await created.json();
      if (!created.ok) {
        setError(body.error ?? '자료를 등록하지 못했어요.');
        return;
      }
      // 계획은 따로 만든다. 가용 시간이 없어 실패해도 자료는 남고, 자료 화면에서 다시 만들 수 있다.
      const planned = await apiFetch(`/api/resources/materials/${body.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dailyUnits: Number(dailyUnits), minutesPerUnit: Math.round(perUnit) }),
      });
      const planBody = planned.ok ? null : await planned.json().catch(() => null);
      router.push(
        `/resources/materials/${body.id}${planBody?.error ? `?notice=${encodeURIComponent(planBody.error)}` : ''}`,
      );
    } catch {
      setError('연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const ready =
    title.trim() && unitLabel.trim() && summary.units > 0 && summary.units <= MAX_UNITS &&
    Number(dailyUnits) >= 1 && perUnit >= 1 && perUnit <= 1440;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <Link href="/resources" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft size={16} aria-hidden="true" />
          서재
        </Link>
        <h1 className="text-2xl font-semibold">교재·강의 추가</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Unit이나 강처럼 챕터로 나뉜 자료예요. 일정은 순서대로 잡히지만, 공부는 아무 챕터나 골라서 할 수 있어요.
        </p>
      </header>

      <form onSubmit={submit} className="space-y-6">
        <Card className="space-y-5 p-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">무엇을 공부하나요?</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['TEXTBOOK', '교재'],
                  ['COURSE', '강의'],
                ] as const
              ).map(([value, text]) => (
                <Button
                  key={value}
                  type="button"
                  variant={kind === value ? 'secondary' : 'outline'}
                  aria-pressed={kind === value}
                  onClick={() => chooseKind(value)}
                >
                  {text}
                </Button>
              ))}
            </div>
          </fieldset>
          <label className="block space-y-2 text-sm" htmlFor="material-title">
            <span className="font-medium">제목</span>
            <Input
              id="material-title"
              required
              maxLength={500}
              value={title}
              placeholder={kind === 'COURSE' ? '강의 이름' : 'Basic Grammar in Use'}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="space-y-2 text-sm">
            <label className="block font-medium" htmlFor="unit-label">
              챕터를 부르는 말
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {labelChoices[kind].map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  size="sm"
                  variant={unitLabel === choice ? 'secondary' : 'outline'}
                  aria-pressed={unitLabel === choice}
                  onClick={() => setUnitLabel(choice)}
                >
                  {choice}
                </Button>
              ))}
              <Input
                id="unit-label"
                required
                maxLength={20}
                value={unitLabel}
                className="w-28"
                onChange={(event) => setUnitLabel(event.target.value)}
              />
            </div>
          </div>
          <label className="block space-y-2 text-sm" htmlFor="material-url">
            <span className="font-medium">링크 (선택)</span>
            <Input
              id="material-url"
              type="url"
              maxLength={2000}
              value={sourceUrl}
              placeholder="https://"
              onChange={(event) => setSourceUrl(event.target.value)}
            />
          </label>
        </Card>

        <Card className="space-y-4 p-5">
          <div>
            <h2 className="font-semibold">목차</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {(
                [
                  ['COUNT', '개수로 만들기'],
                  ['PASTE', '목차 붙여넣기'],
                ] as const
              ).map(([value, text]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={method === value ? 'secondary' : 'outline'}
                  aria-pressed={method === value}
                  onClick={() => {
                    setMethod(value);
                    setRemoved(new Set());
                  }}
                >
                  {text}
                </Button>
              ))}
            </div>
          </div>
          {method === 'COUNT' ? (
            <label className="block space-y-2 text-sm" htmlFor="unit-count">
              <span className="font-medium">모두 몇 {unitLabel || '개'}인가요?</span>
              <Input
                id="unit-count"
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_UNITS}
                value={count}
                placeholder="115"
                className="w-32"
                onChange={(event) => setCount(event.target.value)}
              />
            </label>
          ) : (
            <label className="block space-y-2 text-sm" htmlFor="outline-paste">
              <span className="font-medium">강의 페이지의 커리큘럼을 복사해 붙여 넣으세요</span>
              <textarea
                id="outline-paste"
                value={pasted}
                rows={6}
                className="min-h-36 w-full rounded-lg border border-input bg-background p-3 text-sm leading-6"
                placeholder={'섹션 1. 시작하기\n1. 강의 소개 12:30\n2. 설치 08:10'}
                onChange={(event) => {
                  setPasted(event.target.value);
                  setRemoved(new Set());
                }}
              />
              <span className="block text-xs leading-5 text-muted-foreground">
                섹션을 모두 펼친 뒤 복사하면 강의마다 길이가 들어와요. 접힌 채 복사하면 섹션이 챕터 하나로 들어와요.
              </span>
            </label>
          )}

          {summary.units > 0 && (
            <div className="space-y-2">
              <p className="text-sm">
                <span className="font-medium">
                  {summary.units}
                  {unitLabel}
                </span>
                <span className="text-muted-foreground">
                  {summary.knownMinutes > 0 && ` · 길이를 아는 것 ${formatMinutes(summary.knownMinutes)}`}
                  {summary.untimed > 0 && summary.knownMinutes > 0 && ` · 길이 없는 것 ${summary.untimed}개`}
                </span>
              </p>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                {parsed.map((item, index) =>
                  removed.has(index) ? null : (
                    <li
                      key={index}
                      className={cn('flex items-center gap-3 px-3 py-2', item.section && 'bg-surface-subtle font-medium')}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      {item.minutes !== undefined && (
                        <span className="shrink-0 text-xs text-muted-foreground">{item.minutes}분</span>
                      )}
                      {method === 'PASTE' && (
                        <button
                          type="button"
                          aria-label={`${item.title} 빼기`}
                          className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-danger"
                          onClick={() => setRemoved((current) => new Set(current).add(index))}
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ),
                )}
              </ul>
            </div>
          )}
          {summary.units > MAX_UNITS && (
            <p role="alert" className="text-sm text-danger">
              한 자료에 {MAX_UNITS}개까지 넣을 수 있어요.
            </p>
          )}
        </Card>

        <Card className="space-y-4 p-5">
          <h2 className="font-semibold">계획</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-2 text-sm" htmlFor="daily-units">
              <span className="font-medium">하루에 몇 {unitLabel || '개'}</span>
              <Input
                id="daily-units"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                required
                value={dailyUnits}
                onChange={(event) => setDailyUnits(event.target.value)}
              />
            </label>
            <label className="block space-y-2 text-sm" htmlFor="unit-minutes-default">
              <span className="font-medium">
                {summary.untimed < summary.units ? '길이를 모르는 것은 몇 분으로 볼까요' : `${unitLabel || '챕터'} 하나에 몇 분`}
              </span>
              <Input
                id="unit-minutes-default"
                type="number"
                inputMode="numeric"
                min={1}
                max={1440}
                value={minutesPerUnit}
                placeholder={String(suggested ?? 30)}
                onChange={(event) => setMinutesPerUnit(event.target.value)}
              />
            </label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            하루 개수 안에서, 그날 남은 학습 시간에 들어가는 만큼만 담아요.
            {summary.units > 0 && ` 모두 하면 약 ${formatMinutes(totalMinutes)}이에요.`} 계획은 나중에 바꿀 수 있어요.
          </p>
        </Card>

        {error && (
          <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full sm:w-auto" disabled={busy || !ready}>
          {busy ? '만드는 중…' : '등록하고 일정 만들기'}
        </Button>
      </form>
    </div>
  );
}

function formatMinutes(minutes: number) {
  const whole = Math.round(minutes);
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return hours ? (rest ? `${hours}시간 ${rest}분` : `${hours}시간`) : `${rest}분`;
}
