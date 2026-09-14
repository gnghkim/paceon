'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { mergeYouTubeLibraryItems, type YouTubeLibraryItem } from '@/lib/youtube-library';
import { Button } from './ui/button';
import { youtubeApi, type YouTubeStatus } from './youtube-client';

type Page = { items: YouTubeLibraryItem[]; nextPageToken?: string };

export function YouTubeImport({ onSaved }: { onSaved?: () => void }) {
  const [status, setStatus] = useState<YouTubeStatus>();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<YouTubeLibraryItem[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState(''), [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    // A failed status check hides the entry point; manual links keep working.
    void youtubeApi<YouTubeStatus>('/api/youtube/status').then(value => { if (!cancelled) setStatus(value); }).catch(() => { if (!cancelled) setStatus({ configured: false, connected: false }); });
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'); } finally { setBusy(false); } }
  async function load(value: string, pageToken?: string) {
    const requestGeneration = ++generation.current;
    const page = await youtubeApi<Page>(`/api/youtube/library?${value}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (generation.current !== requestGeneration) return;
    setItems(previous => mergeYouTubeLibraryItems(pageToken ? previous : [], page.items));
    setQuery(value); setNext(page.nextPageToken);
    if (!pageToken) setSelected([]);
  }
  if (!status?.configured) return null;
  if (!status.connected) return <p className="text-sm text-muted-foreground">내 재생목록에서 고르려면 <Link href="/settings" className="text-primary underline">설정에서 YouTube 계정을 연결</Link>하세요.</p>;
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>YouTube에서 가져오기</Button>;
  return <div className="space-y-3 rounded-xl border border-border bg-card p-5" aria-label="YouTube에서 가져오기">
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={busy} onClick={() => void run(() => load('kind=playlists'))}>내 재생목록</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(() => load('kind=subscriptions'))}>구독 채널</Button>
      <Button variant="ghost" onClick={() => { generation.current++; setOpen(false); setItems([]); setSelected([]); setNext(undefined); setQuery(''); }}>닫기</Button>
    </div>
    {query && items.length === 0 && !busy && <p className="text-sm">조회 가능한 항목이 없습니다.</p>}
    <ul className="max-h-80 space-y-2 overflow-auto">
      {items.map(item => <li key={`${item.kind}:${item.id}`}>
        {item.kind === 'video' ? <label className="flex min-h-11 items-start gap-2 rounded border border-border p-2 text-sm">
          <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || (!selected.includes(item.id) && selected.length >= 20)} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))} />
          <span>{item.title}</span>
        </label> : <Button variant="outline" className="w-full justify-start" disabled={busy} onClick={() => void run(() => load(`kind=videos&${item.kind === 'playlist' ? 'playlistId' : 'channelId'}=${encodeURIComponent(item.id)}`))}>{item.title} →</Button>}
      </li>)}
    </ul>
    {next && <Button variant="outline" disabled={busy} onClick={() => void run(() => load(query, next))}>다음 페이지</Button>}
    {items.some(item => item.kind === 'video') && <div className="space-y-2">
      <p className="text-xs text-muted-foreground">선택한 영상의 링크만 저장합니다. YouTube 제목은 현재 화면에서만 표시하며, 저장 후 학습 자료 이름을 직접 정할 수 있습니다.</p>
      <Button disabled={busy || !selected.length} onClick={() => void run(async () => {
        const chosen = [...selected];
        const result = await youtubeApi<{ results: { index: number; error?: string }[] }>('/api/learning/videos', { requestId: crypto.randomUUID(), items: chosen.map(id => ({ url: `https://www.youtube.com/watch?v=${id}` })) });
        const failures = result.results.filter(item => item.error);
        setSelected(failures.map(item => chosen[item.index]).filter((id): id is string => typeof id === 'string'));
        setMessage(`${result.results.length - failures.length}개 저장 또는 기존 자료 재사용${failures.length ? `, ${failures.length}개 실패: ${failures.map(item => item.error).join(', ')}` : ''}`);
        onSaved?.();
      })}>선택한 영상 {selected.length}/20개 저장</Button>
    </div>}
    {busy && <p className="text-sm" role="status">처리 중…</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
  </div>;
}
