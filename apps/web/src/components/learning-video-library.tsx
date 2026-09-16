'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { YouTubeImport } from './youtube-import';
import { isDefaultVideoTitle, parseOEmbedTitle } from '@/lib/youtube';
import { learningDuration, type LearningList, type LearningWorkspace } from './learning-types';

/**
 * 저장된 제목이 아직 기본값인 영상만 YouTube 공개 oEmbed로 실제 제목을 받아 화면에 보여준다.
 * 썸네일과 같은 취급이다. 받은 제목은 DB·브라우저 저장소·AI 입력 어디에도 저장하지 않는다.
 */
function useDisplayTitles(pending: readonly string[]) {
  const [titles, setTitles] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const key = pending.join(',');
  useEffect(() => {
    const controller = new AbortController();
    for (const videoId of key ? key.split(',') : []) {
      if (asked.current.has(videoId)) continue;
      asked.current.add(videoId);
      void fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { signal: controller.signal, cache: 'no-store', referrerPolicy: 'no-referrer' })
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const title = parseOEmbedTitle(body);
          if (title) setTitles((previous) => ({ ...previous, [videoId]: title }));
        })
        // 제목을 못 받으면 저장된 이름을 그대로 쓴다. 카드가 비지 않는다.
        .catch(() => {});
    }
    return () => controller.abort();
  }, [key]);
  return titles;
}

type ImportResult = { index: number; workspace?: LearningWorkspace; duplicate?: boolean; error?: string };
export function LearningVideoLibrary({ data, reload }: { data: LearningList | null; reload: () => Promise<void> }) {
  const { apiFetch } = useAuth();
  const [urls, setUrls] = useState('');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [submitted, setSubmitted] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [archived, setArchived] = useState(false);
  const [favorites, setFavorites] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const request = useRef<{ text: string; requestId: string } | null>(null);
  const lines = urls.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  async function save() {
    if (busy || !lines.length || lines.length > 20) return;
    setBusy(true); setError('');
    if (request.current?.text !== urls) request.current = { text: urls, requestId: crypto.randomUUID() };
    try {
      const response = await apiFetch('/api/learning/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: request.current.requestId, items: lines.map((url) => ({ url })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '링크를 저장하지 못했어요. 다시 시도해 주세요.');
      setResults(body.results); setSubmitted(lines); request.current = null; await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(workspaceId: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/learning/videos/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'VIDEO_REMOVE', requestId: crypto.randomUUID(), workspaceId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? '목록에서 지우지 못했어요. 다시 시도해 주세요.');
      setConfirming(null); await reload();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const videos = (data?.videos ?? []).filter((v) => archived || !v.archived).filter((v) => !favorites || v.favorite).sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const savedTitle = (workspaceId: string) => data?.workspaces.find((w) => w.id === workspaceId)?.title;
  const titles = useDisplayTitles(videos.filter((v) => isDefaultVideoTitle(savedTitle(v.workspace_id), v.video_id)).map((v) => v.video_id));
  return <section className="space-y-4" aria-labelledby="video-library-title">
    <h2 id="video-library-title" className="text-xl font-semibold">YouTube로 공부하기</h2>
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <label htmlFor="video-links" className="text-sm font-medium">영상 링크 · 한 줄에 하나, 최대 20개</label>
      <textarea id="video-links" className="min-h-24 w-full rounded-lg border border-border bg-background p-3 text-sm" placeholder="https://www.youtube.com/watch?v=…" value={urls} onChange={(e) => setUrls(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3"><Button disabled={busy || !lines.length || lines.length > 20} onClick={() => void save()}>{busy ? '저장 중…' : '링크 저장'}</Button><span className="text-xs text-muted-foreground">{lines.length}/20 · 계정 연결 없이 저장할 수 있어요.</span></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {lines.length > 20 && <p role="alert" className="text-sm text-danger">한 번에 20개까지 저장할 수 있어요.</p>}
      <ul aria-live="polite" className="space-y-2 text-sm">{results.map((r) => <li key={r.index}>{r.index + 1}. {r.workspace ? <Link className="text-primary underline" href={`/learn/items/${r.workspace.id}`}>{r.duplicate ? '이미 저장된 영상 열기' : '저장 완료'} · {r.workspace.title}</Link> : <span className="text-danger">{r.error ?? '저장 실패'}</span>}</li>)}</ul>
      {results.some((r) => r.error) && <Button variant="outline" onClick={() => { setUrls(results.filter((r) => r.error).map((r) => submitted[r.index]).filter(Boolean).join('\n')); setResults([]); request.current = null; }}>실패한 링크만 다시 입력</Button>}
      <YouTubeImport onSaved={() => void reload()} />
    </div>
    <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} /> 즐겨찾기만</label><label><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> 보관한 영상 포함</label></div>
    <div className="grid gap-3 sm:grid-cols-2">{videos.map((v) => <div key={v.workspace_id} className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-5">
      <Link href={`/learn/items/${v.workspace_id}`} className="block space-y-2 hover:text-primary">
        {/^[A-Za-z0-9_-]{11}$/.test(v.video_id) && (
          // Fixed YouTube thumbnail host; load directly without persisting provider metadata.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`} alt="" loading="lazy" width={320} height={180} className="aspect-video w-full rounded-lg object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />
        )}
        <p className="break-words font-medium">{v.favorite && '★ '}{titles[v.video_id] ?? savedTitle(v.workspace_id) ?? `YouTube · ${v.video_id}`}</p>
        <p className="text-sm text-muted-foreground">{learningDuration(v.position_seconds)}에서 이어 보기 {v.archived && '· 보관됨'}</p>
        <p className="text-xs text-muted-foreground">YouTube · {v.video_id}</p>
      </Link>
      {confirming === v.workspace_id ? (
        <div role="alert" className="space-y-2 rounded-lg bg-warning-soft p-3 text-sm">
          <p>목록에서만 지워요. 이 영상으로 공부한 시간과 메모는 그대로 남아요. 같은 링크를 다시 저장하면 새 학습이 만들어져요.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void remove(v.workspace_id)}>{busy ? '지우는 중…' : '목록에서 지우기'}</Button>
            <Button variant="outline" disabled={busy} onClick={() => setConfirming(null)}>취소</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => setConfirming(v.workspace_id)}>목록에서 지우기</Button>
      )}
    </div>)}</div>
  </section>;
}
