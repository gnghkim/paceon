'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { AiJobView, AiKind, AiJobsResponse } from '@/lib/ai-types';

type Kind = AiKind;
type Snapshot = AiJobsResponse;
const kinds: Kind[] = ['BOOK_ANALYSIS', 'COACH'];
const titles = { BOOK_ANALYSIS: '도서 분석', COACH: '학습 코칭' };
const active = (job: AiJobView) =>
  job.status === 'PENDING' || job.status === 'PROCESSING';

export function AiInsight({ resourceId, planHref, initialOutline = '' }: {
  resourceId: string;
  planHref: string;
  initialOutline?: string;
}) {
  const { session } = useAuth();
  if (!session) return null;
  return <InsightPanel key={`${session.user.id}:${resourceId}`} resourceId={resourceId} planHref={planHref} initialOutline={initialOutline} />;
}

function InsightPanel({ resourceId, planHref, initialOutline }: {
  resourceId: string;
  planHref: string;
  initialOutline: string;
}) {
  const { apiFetch } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [outlineDraft, setOutlineDraft] = useState<string | null>(null);
  const outline = outlineDraft ?? initialOutline;
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const submission = useRef<AbortController | null>(null);
  const endpoint = `/api/resources/books/${encodeURIComponent(resourceId)}/ai`;

  useEffect(() => () => submission.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 10 * 60 * 1000;
    async function poll() {
      try {
        const response = await apiFetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('status');
        const next: Snapshot = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(next);
        setError(null);
        if (next.available && next.jobs.some(active)) {
          if (Date.now() < deadline) timer = setTimeout(poll, 3000);
          else setPaused(true);
        }
      } catch {
        if (!controller.signal.aborted) {
          setError('AI 작업 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.');
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [apiFetch, endpoint, refresh]);

  function checkStatus() {
    setPaused(false);
    setError(null);
    setRefresh((value) => value + 1);
  }

  async function request(kind: Kind) {
    if (submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setBusy(kind);
    setError(null);
    try {
      const response = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...(kind === 'BOOK_ANALYSIS' ? { outline } : {}) }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.status === 503) {
        setError('지금은 AI 요청을 처리하지 못했어요. 상태를 다시 확인한 뒤 재시도해 주세요.');
        return;
      }
      if (!response.ok) {
        setError(response.status === 429
          ? '진행 중인 AI 작업이 많아요. 작업이 끝난 뒤 다시 요청해 주세요.'
          : 'AI 요청을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      const payload: { job: AiJobView; sourceRevision: string } = await response.json();
      if (controller.signal.aborted) return;
      setSnapshot((previous) => previous ? {
        ...previous,
        sourceRevisions: { ...previous.sourceRevisions, [kind]: payload.sourceRevision },
        jobs: [payload.job, ...previous.jobs.filter((job) => job.id !== payload.job.id)],
      } : previous);
      checkStatus();
    } catch {
      if (!controller.signal.aborted) {
        setError('요청 결과를 확인하지 못했어요. 상태를 다시 확인한 뒤 재시도해 주세요.');
      }
    } finally {
      if (!controller.signal.aborted) {
        submission.current = null;
        setBusy(null);
      }
    }
  }

  return (
    <Card className="space-y-5 p-4 md:p-6" aria-labelledby="ai-insight-title">
      <div>
        <h2 id="ai-insight-title" className="flex items-center gap-2 text-lg font-semibold">
          <Sparkles className="size-5 text-primary" aria-hidden="true" /> AI 독서 인사이트
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          도서 정보와 학습 기록을 바탕으로 한 참고용 추정이에요. 실제 난이도와 시간은 다를 수 있으며, 독서 계획에 자동 반영되지 않아요.
        </p>
      </div>
      {!snapshot && !error && <p role="status" className="text-sm text-muted-foreground">AI 이용 상태를 확인하고 있어요.</p>}
      {snapshot?.available === false && (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          지금은 AI 기능을 이용할 수 없어요. 독서 계획과 학습 기록은 계속 사용할 수 있어요.
        </p>
      )}
      {(error || paused) && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted-foreground">
            {error || '작업이 아직 끝나지 않아 자동 확인을 잠시 멈췄어요. 나중에 상태를 다시 확인해 주세요.'}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={checkStatus}>상태 다시 확인</Button>
        </div>
      )}
      {snapshot?.available && (
        <div className="space-y-2">
          <label htmlFor="ai-outline" className="text-sm font-medium">목차 또는 구성 정보 <span className="font-normal text-muted-foreground">(선택)</span></label>
          <textarea id="ai-outline" value={outline} maxLength={12000} rows={3}
            disabled={busy !== null || snapshot.jobs.some((job) => job.kind === 'BOOK_ANALYSIS' && active(job))}
            onChange={(event) => setOutlineDraft(event.target.value)}
            aria-describedby="ai-outline-help"
            placeholder="분석에 참고할 목차를 붙여 넣어 주세요."
            className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" />
          <p id="ai-outline-help" className="text-xs text-muted-foreground">최대 12,000자 · 비워 두면 도서 정보만 분석하므로 근거가 제한돼요. 입력한 내용은 분석 요청 시 AI에 전달돼요.</p>
        </div>
      )}
      {snapshot && kinds.map((kind) => {
        const jobs = snapshot.jobs.filter((job) => job.kind === kind);
        const latest = jobs[0];
        const running = jobs.some(active);
        const completed = jobs.find((job) => job.status === 'COMPLETED' && job.result);
        const stale = completed && completed.sourceRevision !== snapshot.sourceRevisions[kind];
        return (
          <section key={kind} className="space-y-3 border-t border-border pt-4" aria-label={titles[kind]}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{titles[kind]}</h3>
              {snapshot.available && <Button type="button" variant="outline" size="sm"
                disabled={busy !== null || running} onClick={() => void request(kind)}>
                {busy === kind ? '요청 중…' : running ? '작업 진행 중' : latest?.status === 'FAILED' ? `${titles[kind]} 다시 시도` : `${titles[kind]} 요청`}
              </Button>}
            </div>
            {latest && active(latest) && <p role="status" className="text-sm text-muted-foreground">
              {latest.status === 'PENDING' ? '요청을 접수했어요. 순서대로 작업을 시작해요.' : 'AI가 결과를 만들고 있어요.'} 다른 화면에 다녀와도 작업은 계속돼요.
              {latest.sourceRevision !== snapshot.sourceRevisions[kind] && ' 요청 이후 정보가 변경됐어요. 완료 후 다시 요청하면 최신 정보를 반영해요.'}
            </p>}
            {latest?.status === 'FAILED' && <p role="status" className="text-sm text-muted-foreground">결과를 만들지 못했어요. 다시 시도할 수 있어요.</p>}
            {completed ? <div className="space-y-3">
              {stale && <p className="rounded-lg bg-muted p-3 text-xs">이전 정보로 만든 결과예요. 최신 진도나 계획이 반영되지 않았으니 새로 요청해 주세요.</p>}
              {completed.id !== latest?.id && <p className="text-xs text-muted-foreground">이전 완료 결과</p>}
              <Result job={completed} />
            </div> : !running && latest?.status !== 'FAILED' && snapshot.available && <p className="text-sm text-muted-foreground">원할 때 요청하면 결과를 이곳에서 확인할 수 있어요.</p>}
          </section>
        );
      })}
      <a href={planHref} className="inline-block text-sm font-medium text-primary underline underline-offset-4">독서 계획과 기록 확인</a>
    </Card>
  );
}

function Result({ job }: { job: AiJobView }) {
  const result = job.result;
  if (!result) return null;
  return <>
    <p className="text-xs text-muted-foreground">AI 추정 · 모델 {job.model || '정보 없음'} · 모델이 표시한 신뢰도 {Math.round(result.confidence * 100)}%</p>
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{result.summary}</p>
    {'difficulty' in result ? <>
      <dl className="grid grid-cols-1 gap-3 rounded-lg bg-muted p-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">난이도 추정</dt><dd className="mt-1 font-medium">{{ EASY: '쉬움', MODERATE: '보통', CHALLENGING: '어려움' }[result.difficulty]}</dd></div>
        <div><dt className="text-xs text-muted-foreground">책 전체 예상 시간</dt><dd className="mt-1 font-medium">약 {result.estimatedMinutes.toLocaleString('ko-KR')}분</dd></div>
        <div><dt className="text-xs text-muted-foreground">중요도 추정</dt><dd className="mt-1 font-medium">{{ LOW: '낮음', MEDIUM: '보통', HIGH: '높음' }[result.importance]}</dd></div>
      </dl>
      <p className="text-xs font-medium">추정 근거</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{result.reasons.map((reason, index) => <li key={index} className="break-words">{reason}</li>)}</ul>
    </> : <>
      <p className="text-xs text-muted-foreground">근거: 요청 당시의 진도·계획과 최근 7일 유효 읽기 기록</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">{result.suggestions.map((suggestion, index) => <li key={index} className="break-words">{suggestion}</li>)}</ul>
    </>}
  </>;
}
