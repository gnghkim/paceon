'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { mergeYouTubeLibraryItems, type YouTubeLibraryItem } from '@/lib/youtube-library';

type Item = YouTubeLibraryItem;
type Status = { configured: boolean; connected: boolean; channel?: { id: string; title: string; thumbnail?: string }; error?: string };
type Page = { items: Item[]; nextPageToken?: string };
const button = 'rounded-md border px-3 py-2 text-sm disabled:opacity-50';
async function api<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await getSupabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('로그인이 필요합니다.');
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
  return result as T;
}

export function YouTubeAccount({ onSaved }: { onSaved?: () => void }) {
  const [status, setStatus] = useState<Status>();
  const [items, setItems] = useState<Item[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState(''), [next, setNext] = useState<string>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const requestGeneration = generation.current;
    const result = new URLSearchParams(window.location.search).get('youtube');
    void api<Status>('/api/youtube/status').then(value => {
      if (cancelled || generation.current !== requestGeneration) return;
      setStatus(value);
      if (result) setMessage(result === 'connected' ? 'YouTube 계정이 연결되었습니다.' : result === 'denied' ? 'Google 연결을 취소했습니다.' : 'YouTube 연결을 완료하지 못했습니다. 다시 시도해 주세요.');
    }).catch(error => { if (!cancelled && generation.current === requestGeneration) setMessage(error instanceof Error ? error.message : '연결을 확인할 수 없습니다.'); });
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'); } finally { setBusy(false); } }
  async function load(value: string, pageToken?: string) {
    const requestGeneration = ++generation.current;
    const page = await api<Page>(`/api/youtube/library?${value}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (generation.current !== requestGeneration) return;
    setItems(previous => mergeYouTubeLibraryItems(pageToken ? previous : [], page.items));
    setQuery(value); setNext(page.nextPageToken);
    if (!pageToken) setSelected([]);
  }
  return <section className="space-y-3 rounded-xl border p-4" aria-label="YouTube 계정 연결">
    <h2 className="font-semibold">YouTube 계정 연결</h2>
    <p className="text-sm text-muted-foreground">내 재생목록과 구독 채널에서 직접 선택해 가져옵니다. 읽기 권한만 사용합니다. 계정 연결은 Premium 활성화나 전체 시청 기록·나중에 볼 동영상 동기화를 제공하지 않습니다.</p>
    {!status && <p className="text-sm">연결 상태 확인 중…</p>}
    {status && !status.configured && <p className="text-sm">YouTube 계정 연결 설정이 아직 준비되지 않았습니다. 영상 링크 저장과 학습은 이용할 수 있습니다.</p>}
    {status?.configured && <div className="flex flex-wrap items-center gap-2">
      {status.connected && <span className="flex items-center gap-2 text-sm">{status.channel?.thumbnail && <Image unoptimized src={status.channel.thumbnail} width={28} height={28} alt="" className="rounded-full" />}{status.channel?.title || 'YouTube 계정 연결됨'}</span>}
      <button className={button} disabled={busy} onClick={() => void run(async () => { generation.current++; const result = await api<{ url: string }>('/api/youtube/connect', {}); window.location.assign(result.url); })}>{status.connected ? '다시 연결' : 'Google로 연결'}</button>
      {status.connected && <button className={button} disabled={busy} onClick={() => void run(async () => {
        generation.current++; setItems([]); setSelected([]); setNext(undefined);
        const result = await api<{ revoked: boolean }>('/api/youtube/disconnect', {});
        setStatus({ configured: true, connected: false });
        setMessage(result.revoked ? '연결 및 저장된 인증 정보를 삭제했습니다.' : '저장된 인증 정보는 삭제했습니다. Google 권한 철회는 완료하지 못했습니다. Google 계정의 연결된 앱에서도 접근 권한을 삭제해 주세요.');
      })}>연결 해제</button>}
    </div>}
    {status?.error && <p className="text-sm" role="status">{status.error}</p>}
    {status?.connected && <>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void run(() => load('kind=playlists'))}>내 재생목록</button>
        <button className={button} disabled={busy} onClick={() => void run(() => load('kind=subscriptions'))}>구독 채널</button>
      </div>
      {query && items.length === 0 && !busy && <p className="text-sm">조회 가능한 항목이 없습니다.</p>}
      <ul className="max-h-80 space-y-2 overflow-auto">
        {items.map(item => <li key={`${item.kind}:${item.id}`}>
          {item.kind === 'video' ? <label className="flex items-start gap-2 rounded border p-2 text-sm">
            <input type="checkbox" checked={selected.includes(item.id)} disabled={busy || (!selected.includes(item.id) && selected.length >= 20)} onChange={event => setSelected(previous => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))} />
            <span>{item.title}</span>
          </label> : <button className={`${button} w-full text-left`} disabled={busy} onClick={() => void run(() => load(`kind=videos&${item.kind === 'playlist' ? 'playlistId' : 'channelId'}=${encodeURIComponent(item.id)}`))}>{item.title} →</button>}
        </li>)}
      </ul>
      {next && <button className={button} disabled={busy} onClick={() => void run(() => load(query, next))}>다음 페이지</button>}
      {items.some(item => item.kind === 'video') && <div className="space-y-2">
        <p className="text-xs text-muted-foreground">선택한 영상의 링크만 저장합니다. YouTube 제목은 현재 화면에서만 표시하며, 저장 후 학습 자료 이름을 직접 정할 수 있습니다.</p>
        <button className={button} disabled={busy || !selected.length} onClick={() => void run(async () => {
          const chosen = [...selected];
          const result = await api<{ results: { index: number; error?: string; duplicate?: boolean }[] }>('/api/learning/videos', { requestId: crypto.randomUUID(), items: chosen.map(id => ({ url: `https://www.youtube.com/watch?v=${id}` })) });
          const failures = result.results.filter(item => item.error);
          setSelected(failures.map(item => chosen[item.index]).filter((id): id is string => typeof id === 'string'));
          setMessage(`${result.results.length - failures.length}개 저장 또는 기존 자료 재사용${failures.length ? `, ${failures.length}개 실패: ${failures.map(item => item.error).join(', ')}` : ''}`);
          onSaved?.();
        })}>선택한 영상 {selected.length}/20개 저장</button>
      </div>}
    </>}
    {busy && <p className="text-sm" role="status">처리 중…</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
    <a className="text-xs underline" href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google 계정에서 접근 권한 관리</a>
  </section>;
}
