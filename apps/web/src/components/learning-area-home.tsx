'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Mic, PencilLine } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { LearningVideoLibrary } from './learning-video-library';
import { sessionStatusLabel } from './learning-room-view';
import { workspaceHref } from './learning-areas';
import { learningDuration, type LearningKind, type LearningList } from './learning-types';

const start = {
  SPEAKING: { icon: Mic, title: '영어로 한 문장 말해 볼까요?', body: 'AI가 만든 문장을 듣고 따라 읽거나 자유롭게 말해 보세요. 마이크와 AI는 버튼을 눌러야 시작돼요.', action: '새 스피킹 시작', name: '나의 영어 말하기', prompt: '', empty: '말하기를 시작하면 학습 시간이 기록돼요.' },
  WRITING: { icon: PencilLine, title: '영어로 한 문장 써 볼까요?', body: '목표나 수준 설정 없이 바로 시작하세요. 글은 자동 저장되고, 원할 때만 AI 피드백을 요청할 수 있어요.', action: '새 글 쓰기', name: '나의 영어 쓰기', prompt: '오늘 있었던 일이나 지금 떠오르는 생각을 영어로 써 보세요.', empty: '글을 쓰기 시작하면 학습 시간이 기록돼요.' },
} as const;

export function LearningAreaHome({ kind }: { kind: LearningKind }) {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<LearningList | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creation = useRef<{ requestId: string; workspaceId: string } | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/learning/workspaces?kind=${kind}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('학습실을 불러오지 못했어요. 다시 시도해 주세요.');
      setData(await res.json());
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, [apiFetch, kind]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  async function create(target: 'SPEAKING' | 'WRITING') {
    if (busy) return;
    setBusy(true); setError('');
    creation.current ??= { requestId: crypto.randomUUID(), workspaceId: crypto.randomUUID() };
    try {
      const res = await apiFetch('/api/learning/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...creation.current, kind: target, title: start[target].name, prompt: start[target].prompt }) });
      if (!res.ok) throw new Error('학습실을 만들지 못했어요. 다시 시도하면 같은 요청을 이어갑니다.');
      const body = await res.json();
      router.push(`/learn/${body.workspace.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function more() {
    if (!data || data.nextOffset == null) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/learning/workspaces?kind=${kind}&offset=${data.nextOffset}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('이전 학습실을 불러오지 못했어요.');
      const page = (await res.json()) as LearningList;
      setData((previous) => previous ? {
        ...previous,
        videos: [...(previous.videos ?? []), ...(page.videos ?? [])],
        workspaces: [...new Map([...previous.workspaces, ...page.workspaces].map((w) => [w.id, w])).values()],
        nextOffset: page.nextOffset ?? null,
      } : page);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const creator = kind === 'LISTENING' ? null : start[kind];
  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
          {error}{' '}
          <Button variant="outline" onClick={() => void reload()}>다시 불러오기</Button>
        </div>
      )}
      {kind === 'LISTENING' && <LearningVideoLibrary data={data} reload={reload} />}
      {creator && kind !== 'LISTENING' && (
        <section className="rounded-2xl border border-border bg-primary-soft p-6 sm:p-8">
          <creator.icon className="mb-4 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-semibold">{creator.title}</h2>
          <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">{creator.body}</p>
          <Button className="min-h-11" disabled={busy} onClick={() => void create(kind)}>
            {busy ? '학습실 여는 중…' : creator.action}
            <ArrowRight aria-hidden="true" />
          </Button>
        </section>
      )}
      {kind !== 'LISTENING' && data?.aiEnabled === false && (
        <p className="text-sm text-muted-foreground">현재 AI 피드백은 사용할 수 없어요. 기록과 시간 저장은 계속할 수 있어요.</p>
      )}
      {kind !== 'LISTENING' && data && (data.workspaces.length > 0 || data.nextOffset != null) && (
        <section className="space-y-3" aria-labelledby="area-workspaces-title">
          <h2 id="area-workspaces-title" className="font-semibold">저장한 학습실</h2>
          {data.workspaces.map((w) => (
            <Link key={w.id} href={workspaceHref(w)} className="block min-h-16 rounded-xl border border-border p-4 text-sm">
              <p className="font-medium">{w.title}</p>
              {(w.draft || w.prompt) && <p className="mt-1 truncate text-muted-foreground">{w.draft || w.prompt}</p>}
            </Link>
          ))}
          {data.nextOffset != null && <Button variant="outline" disabled={busy} onClick={() => void more()}>학습실 더 보기</Button>}
        </section>
      )}
      <section aria-labelledby="area-records-title" className="space-y-3">
        <h2 id="area-records-title" className="font-semibold">최근 학습 기록</h2>
        {!data ? (
          <p role="status" className="text-sm text-muted-foreground">학습 기록을 불러오는 중…</p>
        ) : !data.sessions.length ? (
          <p className="text-sm text-muted-foreground">{kind === 'LISTENING' ? '영상을 재생하면 학습 시간이 기록돼요.' : start[kind].empty}</p>
        ) : (
          data.sessions.slice(0, 12).map((s) => (
            <Link key={s.id} href={`${workspaceHref({ id: s.workspace_id, kind })}${kind === 'WRITING' ? '#learning-notes' : ''}`}
              className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">{data.workspaces.find((w) => w.id === s.workspace_id)?.title ?? '학습 기록'}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleDateString('ko-KR')} · {sessionStatusLabel(s.status)} · 기록 보기
                </p>
              </div>
              <span className="font-mono text-sm">{learningDuration(s.elapsed_seconds)}</span>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
