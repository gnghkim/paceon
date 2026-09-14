'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { learningDuration, type LearningList, type LearningWorkspace } from './learning-types';

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
  const videos = (data?.videos ?? []).filter((v) => archived || !v.archived).filter((v) => !favorites || v.favorite).sort((a, b) => Number(b.favorite) - Number(a.favorite));
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
    </div>
    <div className="flex flex-wrap gap-4 text-sm"><label><input type="checkbox" checked={favorites} onChange={(e) => setFavorites(e.target.checked)} /> 즐겨찾기만</label><label><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> 보관한 영상 포함</label></div>
    <div className="grid gap-3 sm:grid-cols-2">{videos.map((v) => <Link key={v.workspace_id} href={`/learn/items/${v.workspace_id}`} className="min-w-0 space-y-2 rounded-xl border border-border bg-card p-5 hover:border-primary">
      {/^[A-Za-z0-9_-]{11}$/.test(v.video_id) && (
        // Fixed YouTube thumbnail host; load directly without persisting provider metadata.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://i.ytimg.com/vi/${v.video_id}/mqdefault.jpg`} alt="" loading="lazy" width={320} height={180} className="aspect-video w-full rounded-lg object-cover" onError={(event) => { event.currentTarget.hidden = true; }} />
      )}
      <p className="break-words font-medium">{v.favorite && '★ '}{data?.workspaces.find((w) => w.id === v.workspace_id)?.title ?? `YouTube ${v.video_id}`}</p><p className="text-sm text-muted-foreground">{learningDuration(v.position_seconds)}에서 이어 보기 {v.archived && '· 보관됨'}</p><p className="text-xs text-muted-foreground">YouTube · {v.video_id}</p>
    </Link>)}</div>
  </section>;
}
