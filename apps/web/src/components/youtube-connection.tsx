'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Button } from './ui/button';
import { youtubeApi, type YouTubeStatus } from './youtube-client';

const results: Record<string, string> = {
  connected: 'YouTube 계정이 연결되었습니다.',
  denied: 'Google 연결을 취소했습니다.',
  failed: 'YouTube 연결을 완료하지 못했습니다. 다시 시도해 주세요.',
};

export function YouTubeConnection() {
  const [status, setStatus] = useState<YouTubeStatus>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    const result = new URLSearchParams(window.location.search).get('youtube');
    if (result) window.history.replaceState(null, '', '/settings');
    void youtubeApi<YouTubeStatus>('/api/youtube/status').then(value => {
      if (cancelled) return;
      setStatus(value);
      if (result) setMessage(results[result] ?? results.failed!);
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : '연결을 확인할 수 없습니다.'); });
    return () => { cancelled = true; };
  }, []);
  async function run(work: () => Promise<void>) { setBusy(true); setMessage(''); try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했습니다.'); } finally { setBusy(false); } }
  return <div className="space-y-3 rounded-xl border border-border bg-card p-5" aria-label="YouTube 계정 연결">
    <h3 className="font-semibold">YouTube</h3>
    <p className="text-sm text-muted-foreground">연결하면 영어 학습 듣기에서 내 재생목록과 구독 채널의 영상을 골라 가져올 수 있어요. 읽기 권한만 사용하며, Premium 활성화나 전체 시청 기록·나중에 볼 동영상 동기화는 제공하지 않아요.</p>
    {!status && !message && <p role="status" className="text-sm">연결 상태 확인 중…</p>}
    {status && !status.configured && <p className="text-sm">YouTube 계정 연결 설정이 아직 준비되지 않았습니다. 영상 링크 저장과 학습은 이용할 수 있습니다.</p>}
    {status?.configured && <div className="flex flex-wrap items-center gap-2">
      {status.connected && <span className="flex items-center gap-2 text-sm">{status.channel?.thumbnail && <Image unoptimized src={status.channel.thumbnail} width={28} height={28} alt="" className="rounded-full" />}{status.channel?.title || 'YouTube 계정 연결됨'}</span>}
      <Button variant="outline" disabled={busy} onClick={() => void run(async () => { const result = await youtubeApi<{ url: string }>('/api/youtube/connect', {}); window.location.assign(result.url); })}>{status.connected ? '다시 연결' : 'Google로 연결'}</Button>
      {status.connected && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        const result = await youtubeApi<{ revoked: boolean }>('/api/youtube/disconnect', {});
        setStatus({ configured: true, connected: false });
        setMessage(result.revoked ? '연결 및 저장된 인증 정보를 삭제했습니다.' : '저장된 인증 정보는 삭제했습니다. Google 권한 철회는 완료하지 못했습니다. Google 계정의 연결된 앱에서도 접근 권한을 삭제해 주세요.');
      })}>연결 해제</Button>}
    </div>}
    {status?.error && <p className="text-sm" role="status">{status.error}</p>}
    {message && <p className="text-sm" role="status">{message}</p>}
    <a className="inline-block min-h-11 py-3 text-xs underline" href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Google 계정에서 접근 권한 관리</a>
  </div>;
}
