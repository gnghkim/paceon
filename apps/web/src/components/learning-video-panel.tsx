'use client';
import { useRef, useState, type RefObject } from 'react';
import { normalizeTranscript } from '@/lib/youtube';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { YouTubePlayer, type PlaybackObservation } from './youtube-player';
import { learningDuration, type LearningVideo, type LearningVideoNote, type LearningVideoVisit } from './learning-types';
import type { LearningRoomTab } from './learning-room-view';

export function LearningVideoPanel({ video, title, tab, notes, visits, stopped, stopToken, onObservation, activity, reload, stopPlaybackRef }: {
  stopPlaybackRef: RefObject<(() => Promise<void>) | null>;
  video: LearningVideo; title: string; tab: LearningRoomTab; notes: LearningVideoNote[]; visits: LearningVideoVisit[];
  stopped: boolean; stopToken: number;
  onObservation: (value: PlaybackObservation) => Promise<boolean>;
  activity: () => void; reload: () => Promise<void>;
}) {
  const { apiFetch } = useAuth();
  const [position, setPosition] = useState(video.position_seconds);
  const [seek, setSeek] = useState<{ seconds: number; token: number } | null>(null);
  const [name, setName] = useState(title);
  const [note, setNote] = useState('');
  const [source, setSource] = useState(video.transcript);
  const [version, setVersion] = useState(video.transcript_version);
  const [start, setStart] = useState(video.context_start);
  const [end, setEnd] = useState(video.context_end);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const retry = useRef<{ signature: string; requestId: string } | null>(null);
  const pendingNote = useRef<{ content: string; noteId: string; positionSeconds: number } | null>(null);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  async function command(payload: Record<string, unknown>) {
    const signature = JSON.stringify(payload);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: crypto.randomUUID() };
    const response = await apiFetch('/api/learning/videos/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, workspaceId: video.workspace_id, requestId: retry.current.requestId }) });
    const body = await response.json();
    if (!response.ok) {
      if (response.status < 500) retry.current = null;
      throw new Error(response.status === 409 ? '다른 곳에서 자막이 바뀌었어요. 내 입력은 유지했습니다. 최신 자막을 확인한 뒤 다시 선택해 주세요.' : body.error ?? '저장하지 못했어요. 다시 시도해 주세요.');
    }
    retry.current = null;
    return body;
  }
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setSaved(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  const chars = Array.from(source);
  const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end <= chars.length && end - start <= 12000;
  return <div className="space-y-5">
    <div className={tab === 'video' ? undefined : 'hidden'}>
      <YouTubePlayer stopPlaybackRef={stopPlaybackRef} videoId={video.video_id} initialPosition={video.position_seconds ?? video.start_seconds} stopped={stopped} stopToken={stopToken} seek={seek} onPosition={setPosition} onObservation={onObservation} />
    </div>
    {tab === 'source' && <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer py-2 text-sm font-medium">영상 제목과 보관 설정</summary>
      <label className="mt-3 block text-sm">내 영상 제목<input className="mt-1 w-full rounded border border-border bg-background p-3" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !name.trim()} onClick={() => void run(async () => { await command({ action: 'VIDEO_EDIT', title: name, favorite: video.favorite, archived: video.archived }); await reload(); })}>제목 저장</Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await command({ action: 'VIDEO_EDIT', title, favorite: !video.favorite, archived: video.archived }); await reload(); })}>{video.favorite ? '즐겨찾기 해제' : '즐겨찾기'}</Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await command({ action: 'VIDEO_EDIT', title, favorite: video.favorite, archived: !video.archived }); await reload(); })}>{video.archived ? '보관 해제' : '보관하기'}</Button>
      </div>
    </details>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {saved && <p role="status" className="text-sm text-primary">{saved}</p>}
    {tab === 'video' && <section className="space-y-3 rounded-xl border border-border p-4">
      <label className="block text-sm font-medium" htmlFor="video-note">이 구간 메모 · {learningDuration(position)}</label>
      <textarea id="video-note" disabled={busy} value={note} maxLength={4000} className="min-h-28 w-full rounded border border-border bg-background p-3" onChange={(e) => { setNote(e.target.value); activity(); }} placeholder="기억할 표현이나 내 생각을 적어 보세요." />
      <Button disabled={busy || !note.trim()} onClick={() => void run(async () => { if (pendingNote.current?.content !== note) pendingNote.current = { noteId: crypto.randomUUID(), positionSeconds: position, content: note }; await command({ action: 'VIDEO_NOTE', ...pendingNote.current }); pendingNote.current = null; setNote(''); await reload(); })}>현재 시각에 메모 저장</Button>
      {notes.map((n) => <article key={n.id} className="border-t border-border py-3"><button className="min-h-11 font-mono text-sm text-primary underline" onClick={() => setSeek({ seconds: n.position_seconds, token: Date.now() })}>{learningDuration(n.position_seconds)}로 이동</button><p className="whitespace-pre-wrap break-words text-sm">{n.content}</p></article>)}
    </section>}
    {tab === 'source' && <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="font-medium">내가 제공하는 자막</h2>
      <p className="text-xs leading-5 text-muted-foreground">TXT/SRT/VTT 1MiB 이하 또는 텍스트를 붙여 넣으세요. AI는 선택한 원문과 최근 메모 20개를 참고하며 영상을 직접 시청하지 않아요. 저장한 다음 질문해 주세요.</p>
      <label className="block text-sm">자막 파일<input type="file" accept=".txt,.srt,.vtt" className="mt-2 block w-full text-sm" disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; void run(async () => { if (file.size > 1048576) throw new Error('파일은 1MiB 이하여야 해요.'); const format = file.name.split('.').pop()?.toLowerCase(); if (!['txt', 'srt', 'vtt'].includes(format ?? '')) throw new Error('TXT/SRT/VTT 파일을 선택해 주세요.'); const normalized = normalizeTranscript(await file.text(), format as 'txt' | 'srt' | 'vtt'); setSource(normalized); setStart(0); setEnd(Math.min(12000, Array.from(normalized).length)); activity(); }); e.target.value = ''; }} /></label>
      <textarea ref={sourceInput} aria-label="자막 원문" disabled={busy} className="min-h-48 w-full rounded border border-border bg-background p-3 text-sm" value={source} onChange={(e) => { setSource(e.target.value); activity(); }} />
      <p className="text-xs">{chars.length.toLocaleString()} / 100,000자 · AI 선택 {Math.max(0, end - start).toLocaleString()} / 12,000자</p>
      <p className="text-xs text-muted-foreground">위 원문에서 원하는 부분을 드래그하거나 키보드로 선택하세요.</p>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => { const input = sourceInput.current; if (!input) return; setStart(Array.from(source.slice(0, input.selectionStart)).length); setEnd(Array.from(source.slice(0, input.selectionEnd)).length); }}>선택한 부분을 AI에 사용</Button><Button variant="outline" disabled={busy} onClick={() => { setStart(0); setEnd(Math.min(12000, chars.length)); }}>처음 12,000자 사용</Button><Button variant="outline" disabled={busy || chars.length > 12000} onClick={() => { setStart(0); setEnd(chars.length); }}>전체 사용</Button></div>
      {!valid && <p role="alert" className="text-sm text-danger">원문 안에서 12,000자 이하의 범위를 선택해 주세요.</p>}
      <details><summary className="cursor-pointer py-2 text-sm">AI에 보낼 선택 원문 미리 보기</summary><p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{valid ? chars.slice(start, end).join('') : ''}</p></details>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !valid || chars.length > 100000} onClick={() => void run(async () => { const result = await command({ action: 'VIDEO_SOURCE', expectedVersion: version, transcript: source, contextStart: start, contextEnd: end }); setVersion(result.video.transcript_version); setSaved('자막과 AI 선택 범위를 저장했어요.'); await reload(); })}>자막과 선택 범위 저장</Button><Button variant="outline" disabled={busy} onClick={() => { setSource(video.transcript); setStart(video.context_start); setEnd(video.context_end); setVersion(video.transcript_version); setError(''); }}>최신 저장본으로 되돌리기</Button></div>
    </section>}
    {tab === 'source' && <section className="space-y-2 rounded-xl border border-border p-4"><h2 className="font-medium">PaceOn에서 본 구간</h2><p className="text-xs text-muted-foreground">반복 시청도 각각 남아요. 재생 위치 차이와 학습 시간은 서로 달라요.</p>{!visits.length && <p className="text-sm">기록한 구간이 아직 없어요.</p>}{visits.map((v) => <button key={v.id} className="block min-h-11 text-sm text-primary underline" onClick={() => setSeek({ seconds: v.from_seconds, token: Date.now() })}>{learningDuration(v.from_seconds)}–{learningDuration(v.to_seconds)} · {v.rate}× · {new Date(v.created_at).toLocaleDateString('ko-KR')}</button>)}</section>}
  </div>;
}
