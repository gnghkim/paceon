'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth-provider';
import { SpeechResult } from './speech-panel';
import type { LearningSpeech } from './learning-types';

/** Recordings made before the area split. Playback does not send SPEECH_TICK and adds no study time. */
export function LegacySpeechRecords({ workspaceId }: { workspaceId: string }) {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<LearningSpeech[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null);
  const release = useCallback(() => {
    audio.current?.pause();
    if (audio.current) URL.revokeObjectURL(audio.current.src);
    audio.current = null;
  }, []);
  const reload = useCallback(async () => {
    const response = await apiFetch(`/api/learning/speech?workspaceId=${workspaceId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '이전 말하기 기록을 불러오지 못했어요.');
    setItems((body.items as LearningSpeech[]).filter((item) => item.kind === 'RECORDING'));
  }, [apiFetch, workspaceId]);
  useEffect(() => {
    const timer = setTimeout(() => void reload().catch((e) => setError((e as Error).message)), 0);
    const hide = () => { if (document.visibilityState !== 'visible') release(); };
    document.addEventListener('visibilitychange', hide);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', hide); release(); };
  }, [reload, release]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function command(id: string, action: string, extra: Record<string, unknown> = {}) {
    const response = await apiFetch('/api/learning/speech/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, requestId: crypto.randomUUID(), id, ...extra }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '요청을 저장하지 못했어요.');
    await reload();
  }
  async function play(id: string) {
    const response = await apiFetch(`/api/learning/speech/${id}/audio`);
    if (!response.ok) throw new Error('음성을 불러오지 못했어요. 삭제 여부와 보관 기한을 확인해 주세요.');
    const blob = await response.blob();
    if (document.visibilityState !== 'visible') return;
    release();
    const player = new Audio(URL.createObjectURL(blob));
    audio.current = player;
    await player.play();
  }
  if (!items.length && !error) return null;
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">이전 말하기 기록 {items.length}개</summary>
      <p className="text-xs text-muted-foreground">영역을 나누기 전에 이 공간에서 녹음한 기록이에요. 새 녹음은 말하기에서 할 수 있어요. 여기서 재생한 시간은 학습 시간에 포함되지 않아요.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {items.map((item) => (
        <SpeechResult key={`${item.id}:${item.status}`} item={item} busy={busy} readOnly
          onCommand={(action, extra) => run(() => command(item.id, action, extra))}
          onPlay={() => run(() => play(item.id))} />
      ))}
    </details>
  );
}
