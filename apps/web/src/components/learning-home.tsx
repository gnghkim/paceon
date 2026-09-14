'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, PencilLine } from 'lucide-react';
import { LearningVideoLibrary } from './learning-video-library';
import { YouTubeAccount } from './youtube-account';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { learningDuration, type LearningList } from './learning-types';

export function LearningHome() {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<LearningList | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creation = useRef<{ requestId: string; workspaceId: string } | null>(
    null,
  );
  const reload = useCallback(async () => {
    try {
      const res = await apiFetch('/api/learning/workspaces', {
        cache: 'no-store',
      });
      if (!res.ok)
        throw new Error('학습실을 불러오지 못했어요. 다시 시도해 주세요.');
      setData(await res.json());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apiFetch]);
  useEffect(() => {
    const timer = setTimeout(() => void reload(), 0);
    return () => clearTimeout(timer);
  }, [reload]);
  async function create(speaking = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    creation.current ??= {
      requestId: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    };
    try {
      const res = await apiFetch('/api/learning/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...creation.current,
          title: speaking ? '나의 영어 말하기' : '나의 영어 쓰기',
          prompt: '오늘 있었던 일이나 지금 떠오르는 생각을 영어로 써 보세요.',
        }),
      });
      if (!res.ok)
        throw new Error(
          '학습실을 만들지 못했어요. 다시 시도하면 같은 요청을 이어갑니다.',
        );
      const body = await res.json();
      router.push(`/learn/${body.workspace.id}${speaking ? '#learning-speech' : ''}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  const writing = data?.workspaces.filter((w) => !data.videos?.some((v) => v.workspace_id === w.id)) ?? [];
  const resume = (data?.workspaces ?? [])
    .filter((w) => !data?.videos?.some((v) => v.workspace_id === w.id && v.archived))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 3);
  const remainingWriting = writing.filter((w) => !resume.some((item) => item.id === w.id));
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <p className="mb-2 text-sm font-medium text-primary">
          나만의 작은 영어 연습
        </p>
        <h1 className="text-3xl font-semibold">학습실</h1>
        <p className="mt-3 text-muted-foreground">
          한 문장부터, 내 속도로 이어가요.
        </p>
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl bg-danger-soft p-4 text-sm text-danger"
        >
          {error}{' '}
          <Button variant="outline" onClick={() => void reload()}>
            다시 불러오기
          </Button>
        </div>
      )}
      {!!resume.length && (
        <section aria-labelledby="resume-title" className="space-y-3">
          <h2 id="resume-title" className="font-semibold">
            이어서 공부하기
          </h2>
          {resume.map((w) => {
            const video = data?.videos?.find((v) => v.workspace_id === w.id);
            return (
            <Link
              key={w.id}
              href={video ? `/learn/items/${w.id}` : `/learn/${w.id}`}
              className="flex min-h-24 items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 hover:border-primary"
            >
              <div className="min-w-0">
                <h3 className="break-words font-medium">{w.title}</h3>
                <p className="mt-2 truncate text-sm text-muted-foreground">
                  {video ? `YouTube · ${learningDuration(video.position_seconds)}에서 이어 보기` : w.draft || w.prompt || '이전 글과 피드백 이어 보기'}
                </p>
              </div>
              <ArrowRight
                className="shrink-0 text-primary"
                aria-hidden="true"
              />
            </Link>
            );
          })}
        </section>
      )}
      <LearningVideoLibrary data={data} reload={reload} />
      <YouTubeAccount onSaved={() => void reload()} />
      <section className="rounded-2xl border border-border bg-primary-soft p-6 sm:p-8">
        <PencilLine className="mb-4 text-primary" aria-hidden="true" />
        <h2 className="text-xl font-semibold">영어로 한 문장 써 볼까요?</h2>
        <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground">
          목표나 수준 설정 없이 바로 시작하세요. 글은 자동 저장되고, 원할 때만
          AI 피드백을 요청할 수 있어요.
        </p>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? '학습실 여는 중…' : '새 글 쓰기'}
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button className="min-h-11 sm:ml-2" variant="outline" disabled={busy} onClick={() => void create(true)}>스피킹 시작</Button>
      </section>
      {data?.aiEnabled === false && (
        <p className="text-sm text-muted-foreground">
          현재 AI 피드백은 사용할 수 없어요. 글 작성과 저장, 시간 기록은 계속할
          수 있어요.
        </p>
      )}
      {data && (remainingWriting.length > 0 || data.nextOffset != null) && (
        <section className="space-y-3" aria-labelledby="all-learning-title">
          <h2 id="all-learning-title" className="font-semibold">
            저장한 학습실
          </h2>
          {remainingWriting.map((w) => (
            <Link
              key={w.id}
              href={`/learn/${w.id}`}
              className="block min-h-16 rounded-xl border border-border p-4 text-sm"
            >
              <p className="font-medium">{w.title}</p>
              <p className="mt-1 truncate text-muted-foreground">
                {w.draft || w.prompt}
              </p>
            </Link>
          ))}
          {data.nextOffset != null && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const res = await apiFetch(
                    `/api/learning/workspaces?offset=${data.nextOffset}`,
                    { cache: 'no-store' },
                  );
                  if (!res.ok)
                    throw new Error('이전 학습실을 불러오지 못했어요.');
                  const page = (await res.json()) as LearningList;
                  setData((previous) =>
                    previous
                      ? {
                          ...previous,
                          videos: [...(previous.videos ?? []), ...(page.videos ?? [])],
                          workspaces: [
                            ...new Map(
                              [...previous.workspaces, ...page.workspaces].map(
                                (w) => [w.id, w],
                              ),
                            ).values(),
                          ],
                        nextOffset: page.nextOffset ?? null,
                        }
                      : page,
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              학습실 더 보기
            </Button>
          )}
        </section>
      )}
      <section aria-labelledby="records-title" className="space-y-3">
        <h2 id="records-title" className="font-semibold">
          최근 학습 기록과 노트
        </h2>
        {!data ? (
          <p role="status" className="text-sm text-muted-foreground">
            학습 기록을 불러오는 중…
          </p>
        ) : !data.sessions.length ? (
          <p className="text-sm text-muted-foreground">
            글을 쓰기 시작하면 학습 시간이 기록돼요.
          </p>
        ) : (
          data.sessions.slice(0, 12).map((s) => (
            <Link
              key={s.id}
              href={`/learn/${s.workspace_id}#learning-notes`}
              className="flex min-h-16 items-center justify-between gap-3 rounded-xl border border-border p-4"
            >
              <div>
                <p className="text-sm font-medium">
                  {data.workspaces.find((w) => w.id === s.workspace_id)
                    ?.title ?? '영어 쓰기'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(s.started_at).toLocaleDateString('ko-KR')} ·{' '}
                  {s.status === 'ENDED'
                    ? '종료'
                    : s.status === 'PAUSED'
                      ? '일시 정지'
                      : '진행 중'}{' '}
                  · 기록·노트 보기
                </p>
              </div>
              <span className="font-mono text-sm">
                {learningDuration(s.elapsed_seconds)}
              </span>
            </Link>
          ))
        )}
      </section>
    </div>
  );
}
