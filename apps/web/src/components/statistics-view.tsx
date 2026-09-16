'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { addDays } from '@paceon/scheduler';
import { ArrowRight, ChartColumn } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import type { StatisticsData } from '@/lib/statistics';
import { buildHeatmap, computeStreak, countActiveDays, formatStudyDuration, type HeatmapDay } from '@/lib/study-heatmap';
import { StudyHeatmap } from './study-heatmap';
import { WORKSPACE_CHANGED } from '@/lib/quick-record';

const number = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const fieldClass =
  'h-11 min-w-0 w-full rounded-lg border border-border bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function StatisticsView() {
  const { session } = useAuth();
  return session ? <StatisticsContent key={session.user.id} /> : <Loading />;
}

function StatisticsContent() {
  const { session, apiFetch } = useAuth();
  const [query, setQuery] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener(WORKSPACE_CHANGED, refresh);
    return () => window.removeEventListener(WORKSPACE_CHANGED, refresh);
  }, []);
  const [context, setContext] = useState<{
    today: string;
    timezone: string;
  } | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [period, setPeriod] = useState<number | 'custom'>(30);
  const [validation, setValidation] = useState<string | null>(null);
  const key = `${session?.user.id ?? ''}:${query}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    data: StatisticsData | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void apiFetch(`/api/statistics${query}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? '통계를 불러오지 못했어요.');
        if (controller.signal.aborted) return;
        const data = body as StatisticsData;
        setResult({ key, data, error: null });
        setContext({ today: data.today, timezone: data.timezone });
        if (!query) {
          setFrom(data.from);
          setTo(data.to);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            error:
              error instanceof Error && !(error instanceof TypeError)
                ? error.message
                : '연결을 확인하고 다시 시도해 주세요.',
          });
      });
    return () => controller.abort();
  }, [apiFetch, session, key, query]);

  const [heatmap, setHeatmap] = useState<{ key: string; data: StatisticsData | null; error: string | null } | null>(null);
  const heatmapKey = `${session?.user.id ?? ''}:${context?.today ?? ''}:${revision}`;
  useEffect(() => {
    if (!session || !context) return;
    const controller = new AbortController();
    void apiFetch(`/api/statistics?from=${addDays(context.today, -365)}&to=${context.today}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '학습 잔디를 불러오지 못했어요.');
        if (!controller.signal.aborted) setHeatmap({ key: heatmapKey, data: body as StatisticsData, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setHeatmap({
            key: heatmapKey,
            data: null,
            error: error instanceof Error && !(error instanceof TypeError) ? error.message : '연결을 확인하고 다시 시도해 주세요.',
          });
      });
    return () => controller.abort();
  }, [apiFetch, session, context, heatmapKey]);
  const currentHeatmap = heatmap?.key === heatmapKey ? heatmap : null;

  const current = result?.key === key ? result : null;
  function selectPeriod(days: number) {
    if (!context) return;
    const start = addDays(context.today, 1 - days);
    setFrom(start);
    setTo(context.today);
    setPeriod(days);
    setValidation(null);
    setQuery(`?from=${start}&to=${context.today}`);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context) return;
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    const validDate = (value: string, time: number) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value;
    if (
      !validDate(from, start) ||
      !validDate(to, end) ||
      end < start ||
      (end - start) / 86400000 >= 366 ||
      to > context.today
    ) {
      setValidation(
        '시작일부터 종료일까지 최대 366일을 선택해 주세요. 종료일은 오늘을 넘을 수 없어요.',
      );
      return;
    }
    setValidation(null);
    setPeriod('custom');
    setQuery(`?from=${from}&to=${to}`);
    setRevision((value) => value + 1);
  }

  return (
    <div className="min-w-0 space-y-7">
      <header>
        <p className="mb-2 text-sm text-muted-foreground">
          기록으로 돌아보는 나의 학습
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">학습 통계</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          책과 영어학습에 남긴 기록을 모았어요. 자료 등록 전 읽은 분량은 포함하지
          않아요.
        </p>
      </header>
      <section aria-labelledby="study-heatmap-heading" className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 id="study-heatmap-heading" className="font-semibold">
          최근 1년 학습 잔디
        </h2>
        {!currentHeatmap ? (
          <Skeleton className="h-24 w-full" />
        ) : currentHeatmap.error ? (
          <p role="alert" className="text-sm text-danger">
            {currentHeatmap.error}
          </p>
        ) : currentHeatmap.data ? (
          <StudyHeatmapSection data={currentHeatmap.data} />
        ) : null}
      </section>
      <section
        aria-label="통계 기간 선택"
        className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5"
      >
        <div className="flex flex-wrap gap-2">
          {[7, 30, 90].map((days) => (
            <Button
              key={days}
              type="button"
              variant={period === days ? 'secondary' : 'outline'}
              aria-pressed={period === days}
              disabled={!context}
              onClick={() => selectPeriod(days)}
            >
              최근 {days}일
            </Button>
          ))}
        </div>
        <form
          onSubmit={submit}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label className="min-w-0 space-y-2 text-sm">
            <span className="block">시작일</span>
            <input
              type="date"
              required
              max={context?.today}
              value={from}
              disabled={!context}
              onChange={(event) => setFrom(event.target.value)}
              className={fieldClass}
              aria-describedby="statistics-period-help"
            />
          </label>
          <label className="min-w-0 space-y-2 text-sm">
            <span className="block">종료일</span>
            <input
              type="date"
              required
              min={from || undefined}
              max={context?.today}
              value={to}
              disabled={!context}
              onChange={(event) => setTo(event.target.value)}
              className={fieldClass}
              aria-describedby="statistics-period-help"
            />
          </label>
          <Button type="submit" disabled={!context} className="h-11">
            기간 적용
          </Button>
        </form>
        <p
          id="statistics-period-help"
          className="text-xs leading-5 text-muted-foreground"
        >
          시작일과 종료일을 포함해 최대 366일
          {context ? ` · ${context.timezone} 기준 오늘 ${context.today}` : ''}
        </p>
        {validation && (
          <p role="alert" className="text-sm text-danger">
            {validation}
          </p>
        )}
      </section>
      {!current ? (
        <Loading />
      ) : current.error ? (
        <div
          role="alert"
          className="rounded-xl border border-border bg-card p-6"
        >
          <h2 className="font-semibold">통계를 불러오지 못했어요</h2>
          <p className="mt-2 mb-4 text-sm text-muted-foreground">
            {current.error}
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            다시 불러오기
          </Button>
        </div>
      ) : current.data ? (
        <StatisticsReport data={current.data} />
      ) : null}
    </div>
  );
}

function StudyHeatmapSection({ data }: { data: StatisticsData }) {
  const [selected, setSelected] = useState<HeatmapDay | null>(null);
  const heatmapDays = buildHeatmap(data.days);
  // buildStatistics의 summary.activeDays는 도서 기록 기준이라 영어학습만 있는 날을 놓친다.
  const activeDays = countActiveDays(heatmapDays);
  const streak = computeStreak(heatmapDays, data.today);
  const totalMinutes = data.summary.learningMinutes + data.summary.recordedMinutes;
  const detail = selected ? data.days.find((day) => day.date === selected.date) : null;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        최근 1년 {formatStudyDuration(totalMinutes)} · 학습한 날 {activeDays}일 · 연속 {streak.current}일 · 최장 연속{' '}
        {streak.longest}일
      </p>
      <StudyHeatmap days={heatmapDays} onSelectDay={setSelected} />
      {detail && (
        <p role="status" className="text-sm">
          <time dateTime={detail.date}>{detail.date}</time> · {formatStudyDuration(detail.learningMinutes + detail.recordedMinutes)}
          {detail.learningMinutes || detail.recordedMinutes
            ? ` · 도서 ${detail.recordedMinutes}분 · 영어학습 ${detail.learningMinutes}분`
            : ' · 기록 없음'}
        </p>
      )}
    </>
  );
}

function Loading() {
  return (
    <div role="status" className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
      <span className="sr-only">학습 통계를 불러오고 있어요.</span>
    </div>
  );
}

function StatisticsReport({ data }: { data: StatisticsData }) {
  const { summary } = data;
  const maxPages = Math.max(
    1,
    ...data.days.map((day) => day.learningPages + day.reviewPages),
  );
  // 도서 기록만 세는 summary.activeDays 대신, 잔디와 같은 기준으로 영어학습만 한 날도 센다.
  const activeDays = countActiveDays(buildHeatmap(data.days));
  return (
    <div className="space-y-7">
      <p className="text-sm text-muted-foreground" role="status">
        {data.from} ~ {data.to} · 학습 기록 {number.format(summary.events)}건
      </p>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          ['새로 학습한 분량', `${number.format(summary.learningPages)}쪽`, '도서 기록 기준'],
          ['복습한 분량', `${number.format(summary.reviewPages)}쪽`, '도서 기록 기준'],
          ['기록된 시간', `${number.format(summary.recordedMinutes)}분`, '도서에 직접 입력한 시간'],
          ['영어학습 시간', `${number.format(summary.learningMinutes)}분`, '타이머로 잰 시간'],
          ['학습한 날', `${number.format(activeDays)}일`, '도서·영어학습 합쳐서'],
        ].map(([label, value, note]) => (
          <div
            key={label}
            className="rounded-xl border border-border bg-card p-4 sm:p-5"
          >
            <dt className="text-xs text-muted-foreground sm:text-sm">
              {label}
            </dt>
            <dd className="mt-3 text-2xl font-semibold tabular-nums">
              {value}
            </dd>
            <p className="mt-2 text-xs text-muted-foreground">{note}</p>
          </div>
        ))}
      </dl>
      <section
        aria-label="시간 기록 안내"
        className="rounded-xl bg-muted p-5 text-sm leading-6"
      >
        <p>
          시간 입력 {number.format(summary.timedEvents)}건 · 시간 미입력{' '}
          {number.format(summary.untimedEvents)}건
        </p>
        <p className="text-muted-foreground">
          기록된 시간은 도서에 입력한 분만 합산했어요. 미입력 기록의 소요 시간은
          알 수 없어요. 영어학습 시간은 타이머가 잰 값이라 따로 표시하며, 두
          시간이 겹칠 수 있어 합계를 순수 집중 시간으로 보지 않아요.
        </p>
        <p className="mt-3 font-medium">
          기간 내 기록 속도:{' '}
          {summary.minutesPerPage === null
            ? '계산할 기록이 없어요'
            : summary.minutesPerPage > 0 && summary.minutesPerPage < 0.01
              ? '0.01분/쪽 미만'
              : `${number.format(summary.minutesPerPage)}분/쪽`}
        </p>
        <p className="text-muted-foreground">
          0분보다 큰 시간이 입력된 새 학습 기록으로 계산해요. 복습과 0분 기록은
          제외하며, 계획의 예상 속도와는 달라요.
        </p>
      </section>
      {summary.events === 0 && (
        <section className="rounded-xl border border-dashed border-border px-5 py-9 text-center">
          <ChartColumn
            aria-hidden="true"
            className="mx-auto mb-3 text-primary"
          />
          <h2 className="font-semibold">이 기간에는 학습 기록이 없어요</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            다른 기간을 선택하거나 서재에서 읽은 분량을 기록해 보세요.
          </p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/resources">서재에서 기록하기</Link>
          </Button>
        </section>
      )}
      <section aria-labelledby="statistics-daily-heading" className="space-y-3">
        <h2 id="statistics-daily-heading" className="font-semibold">
          날짜별 학습
        </h2>
        <p className="text-xs text-muted-foreground">
          복습은 같은 페이지를 다시 읽은 분량도 포함해요. 막대 길이는 새 학습과
          복습의 합계예요.
        </p>
        <div
          className="max-h-[480px] overflow-auto rounded-xl border border-border bg-card"
          tabIndex={0}
          role="region"
          aria-label="날짜별 학습 표, 스크롤 가능"
        >
          <table className="w-full min-w-[500px] text-sm tabular-nums">
            <caption className="sr-only">
              {data.from}부터 {data.to}까지 날짜별 학습과 복습 분량, 입력된
              시간, 영어학습 시간, 시간 미입력 건수
            </caption>
            <thead className="sticky top-0 bg-surface-subtle text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 text-left">
                  날짜
                </th>
                <th scope="col" className="p-3 text-right">
                  새 학습
                </th>
                <th scope="col" className="p-3 text-right">
                  복습
                </th>
                <th scope="col" className="p-3 text-right">
                  기록 시간
                </th>
                <th scope="col" className="p-3 text-right">
                  영어학습
                </th>
                <th scope="col" className="p-3 text-right">
                  시간 미입력
                </th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr key={day.date} className="border-t border-border">
                  <th scope="row" className="w-36 p-3 text-left font-normal">
                    <time dateTime={day.date}>{day.date}</time>
                    <div
                      aria-hidden="true"
                      className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className="bg-primary"
                        style={{
                          width: `${(day.learningPages / maxPages) * 100}%`,
                        }}
                      />
                      <span
                        className="bg-primary/40"
                        style={{
                          width: `${(day.reviewPages / maxPages) * 100}%`,
                        }}
                      />
                    </div>
                  </th>
                  <td className="p-3 text-right">
                    {number.format(day.learningPages)}쪽
                  </td>
                  <td className="p-3 text-right">
                    {number.format(day.reviewPages)}쪽
                  </td>
                  <td className="p-3 text-right">
                    {number.format(day.recordedMinutes)}분
                  </td>
                  <td className="p-3 text-right">
                    {number.format(day.learningMinutes)}분
                  </td>
                  <td className="p-3 text-right">
                    {number.format(day.untimedEvents)}건
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section
        aria-labelledby="statistics-resources-heading"
        className="space-y-3"
      >
        <h2 id="statistics-resources-heading" className="font-semibold">
          자료별 기록
        </h2>
        {data.resources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            선택한 기간에 기록한 자료가 없어요.
          </p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {data.resources.map((resource) => (
              <li
                key={resource.id}
                className="min-w-0 rounded-xl border border-border bg-card p-5"
              >
                <Link
                  href={`/resources/${resource.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 font-medium text-primary"
                >
                  <span className="min-w-0 break-words">{resource.title}</span>
                  <ArrowRight
                    aria-hidden="true"
                    size={16}
                    className="shrink-0"
                  />
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {resource.source === 'PDF_IMPORT' ? 'PDF' : '도서'} · 학습{' '}
                  {number.format(resource.activeDays)}일 · 기록{' '}
                  {number.format(resource.events)}건
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">새 학습</dt>
                    <dd className="mt-1">
                      {number.format(resource.learningPages)}쪽
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">복습</dt>
                    <dd className="mt-1">
                      {number.format(resource.reviewPages)}쪽
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">기록된 시간</dt>
                    <dd className="mt-1">
                      {number.format(resource.recordedMinutes)}분
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">시간 미입력</dt>
                    <dd className="mt-1">
                      {number.format(resource.untimedEvents)}건
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
