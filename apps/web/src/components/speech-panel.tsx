'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import type { LearningSpeech } from './learning-types';
import { speechWordDifferences } from './speech-diff';
import { speechDraftStorage, type SpeechDraft } from './speech-draft';

export function SpeechPanel({ workspaceId, ownerId, stopped, stopToken, stopSpeechRef, onMedia, stopVideo }: {
  workspaceId: string; ownerId: string; stopped: boolean; stopToken: number;
  stopSpeechRef: RefObject<(() => Promise<void>) | null>;
  onMedia: (phase: 'prepare' | 'active' | 'stop') => Promise<string | null>;
  stopVideo: () => Promise<void>;
}) {
  const { apiFetch } = useAuth();
  const [items, setItems] = useState<LearningSpeech[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [topic, setTopic] = useState('');
  const [level, setLevel] = useState('EASY');
  const [reference, setReference] = useState('');
  const [draft, setDraft] = useState<SpeechDraft | null>(null);
  const [preview, setPreview] = useState('');
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [pendingPrompt, setPendingPrompt] = useState(false);
  const promptRequest = useRef<Record<string, unknown> | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const recordingSaved = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const live = useRef(false);
  const callbacks = useRef({ onMedia, stopped });
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const key = `${ownerId}:${workspaceId}`;
  useEffect(() => { callbacks.current = { onMedia, stopped }; }, [onMedia, stopped]);
  const reload = useCallback(async () => {
    const response = await apiFetch(`/api/learning/speech?workspaceId=${workspaceId}`, { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '말하기 기록을 불러오지 못했어요.');
    setItems(body.items); setEnabled(body.enabled);
  }, [apiFetch, workspaceId]);
  const persist = useCallback(async (value: SpeechDraft | null) => {
    setDraft(value);
    try { const write = writes.current.catch(() => {}).then(() => speechDraftStorage(key, value)); writes.current = write; await write; setSaved(value ? '미분석 녹음을 이 기기에 보관했어요.' : ''); }
    catch { setError('이 기기에 녹음을 저장하지 못했어요. 페이지를 닫기 전에 녹음을 내려받아 주세요.'); }
  }, [key]);
  const stop = useCallback(async () => {
    generation.current++;
    audio.current?.pause();
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null;
    queueMicrotask(() => setRecording(false));
    if (live.current) { live.current = false; await callbacks.current.onMedia('stop'); }
    await recordingSaved.current;
  }, []);
  useEffect(() => { stopRef.current = stop; stopSpeechRef.current = stop; return () => { stopSpeechRef.current = null; }; }, [stop, stopSpeechRef]);
  useEffect(() => {
    let disposed = false;
    try { const raw = sessionStorage.getItem(`paceon:speech-prompt:${key}`); if (raw) { promptRequest.current = JSON.parse(raw); queueMicrotask(() => setPendingPrompt(true)); } } catch { /* In-memory retry remains available. */ }
    void speechDraftStorage(key).then((value) => { if (!disposed && value) { setDraft(value); setReference(value.reference); setSaved('이 기기에 보관한 미분석 녹음을 복원했어요.'); } }).catch(() => { if (!disposed) setError('이 브라우저에서 녹음 보관을 사용할 수 없어요.'); });
    const initial = setTimeout(() => void reload().catch((e) => setError(e.message)), 0);
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void reload().catch(() => {}); }, 5000);
    const beat = setInterval(() => { if (live.current) void callbacks.current.onMedia('active').then((id) => { if (!id) void stopRef.current(); }); }, 10000);
    const hide = () => { if (document.visibilityState !== 'visible') void stopRef.current(); };
    const signout = (event: Event) => { if ((event as CustomEvent<string>).detail !== ownerId) return; void stopRef.current(); setDraft(null); setPreview(''); if (audio.current) { URL.revokeObjectURL(audio.current.src); audio.current = null; } };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('paceon:speech-signout', signout);
    return () => { disposed = true; clearTimeout(initial); clearInterval(poll); clearInterval(beat); document.removeEventListener('visibilitychange', hide); window.removeEventListener('paceon:speech-signout', signout); void stopRef.current(); if (audio.current) { URL.revokeObjectURL(audio.current.src); audio.current = null; } };
  }, [key, reload, ownerId]);
  useEffect(() => { if (stopped || stopToken > 0) void stop(); }, [stopped, stopToken, stop]);
  useEffect(() => { const url = draft ? URL.createObjectURL(draft.blob) : ''; const timer = setTimeout(() => setPreview(url), 0); return () => { clearTimeout(timer); if (url) URL.revokeObjectURL(url); }; }, [draft]);
  async function run(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); try { await work(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function command(action: string, extra: Record<string, unknown>) {
    let payload = { action, requestId: crypto.randomUUID(), ...(action === 'PROMPT' ? { workspaceId } : {}), ...extra } as Record<string, unknown>;
    if (action === 'PROMPT') { promptRequest.current ??= payload; payload = promptRequest.current; setPendingPrompt(true); try { sessionStorage.setItem(`paceon:speech-prompt:${key}`, JSON.stringify(payload)); } catch { /* In-memory retry remains available. */ } }
    const response = await apiFetch('/api/learning/speech/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json();
    if (action === 'PROMPT' && (response.ok || response.status < 500)) { promptRequest.current = null; setPendingPrompt(false); try { sessionStorage.removeItem(`paceon:speech-prompt:${key}`); } catch { /* Ignore unavailable storage. */ } }
    if (!response.ok) throw new Error(body.error ?? '요청을 저장하지 못했어요.'); await reload(); return body.item;
  }
  async function remotePlay(id: string) {
    const token = generation.current;
    const response = await apiFetch(`/api/learning/speech/${id}/audio`);
    if (!response.ok) throw new Error('음성을 불러오지 못했어요. 삭제 여부와 보관 기한을 확인해 주세요.');
    const blob = await response.blob();
    if (token !== generation.current || callbacks.current.stopped || document.visibilityState !== 'visible') return;
    await play(blob);
  }
  async function play(blob: Blob) {
    await stop(); await stopVideo(); const token = generation.current;
    if (!await onMedia('prepare') || token !== generation.current || callbacks.current.stopped) return;
    if (audio.current) URL.revokeObjectURL(audio.current.src);
    const player = new Audio(URL.createObjectURL(blob)); audio.current = player;
    player.onplaying = () => { if (token !== generation.current || callbacks.current.stopped) { player.pause(); return; } live.current = true; void onMedia('active').then((id) => { if (!id) void stop(); }); };
    player.onpause = player.onended = () => { if (live.current) { live.current = false; void onMedia('stop'); } };
    player.onerror = () => { void stop(); setError('음성을 재생할 수 없어요.'); };
    try { await player.play(); } catch { await stop(); throw new Error('재생 버튼을 다시 눌러 주세요.'); }
  }
  async function record() {
    await stop(); await stopVideo(); const token = generation.current;
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 녹음을 지원하지 않아요. 아래 영어 쓰기를 이용해 주세요.');
    setSaved('마이크 권한 확인 중…');
    const media = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => { throw new Error('마이크를 허용하지 않았거나 사용할 수 없어요. 아래 영어 쓰기를 이용할 수 있어요.'); });
    if (token !== generation.current || callbacks.current.stopped || document.visibilityState !== 'visible') { media.getTracks().forEach((track) => track.stop()); return; }
    stream.current = media;
    let sessionId: string | null;
    try { sessionId = await onMedia('prepare'); } catch (e) { media.getTracks().forEach((track) => track.stop()); throw e; }
    if (!sessionId || token !== generation.current || callbacks.current.stopped || document.visibilityState !== 'visible') { media.getTracks().forEach((track) => track.stop()); return; }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((type) => MediaRecorder.isTypeSupported(type));
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(media, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 }); } catch (e) { media.getTracks().forEach((track) => track.stop()); throw e; }
    recorder.current = rec;
    const chunks: Blob[] = []; let size = 0; const begun = Date.now(); const id = crypto.randomUUID(); const ref = reference;
    let resolveSaved: () => void = () => {};
    recordingSaved.current = new Promise<void>((resolve) => { resolveSaved = resolve; });
    let lastCheckpoint = 0;
    const maximum = setTimeout(() => void stop(), 59000);
    const interval = setInterval(() => { const elapsed = Math.min(60, (Date.now() - begun) / 1000); setSeconds(elapsed); }, 200);
    rec.ondataavailable = (event) => { if (!event.data.size) return; size += event.data.size; if (size <= 10 * 1024 * 1024) { chunks.push(event.data); if (Date.now() - lastCheckpoint >= 1000) { lastCheckpoint = Date.now(); void persist({ id, blob: new Blob(chunks, { type: rec.mimeType }), reference: ref, sessionId: sessionId!, seconds: Math.min(60, (Date.now() - begun) / 1000) }); } } else { setError('10MiB 제한에 도달해 녹음을 멈췄어요. 짧게 다시 녹음해 주세요.'); void stop(); } };
    rec.onstop = () => { clearInterval(interval); clearTimeout(maximum); media.getTracks().forEach((track) => track.stop()); const blob = new Blob(chunks, { type: rec.mimeType }); if (blob.size) void persist({ id, blob, reference: ref, sessionId: sessionId!, seconds: Math.min(60, (Date.now() - begun) / 1000) }).finally(resolveSaved); else resolveSaved(); };
    rec.onerror = () => { setError('녹음이 중단됐어요. 저장된 녹음을 확인해 주세요.'); void stop(); };
    try { rec.start(250); setRecording(true); setSeconds(0); setSaved(''); live.current = true; if (!await onMedia('active')) await stop(); } catch (e) { clearInterval(interval); clearTimeout(maximum); if (rec.state === 'inactive') resolveSaved(); await stop(); throw e; }
  }
  return <section id="learning-speech" className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="말하기 연습">
    <h2 className="text-lg font-semibold">한 문장 말하기</h2>
    <p className="text-sm text-muted-foreground">문장을 듣고 따라 읽거나 자유롭게 말해 보세요. 마이크와 AI는 버튼을 눌러야 시작돼요.</p>
    <details><summary className="min-h-11 cursor-pointer py-3 text-sm">문장 난이도와 주제</summary><label className="block py-2 text-sm">난이도 <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded border border-border bg-background p-2"><option value="EASY">쉬운 일상 영어</option><option value="MEDIUM">조금 더 긴 문장</option></select></label><label className="block text-sm">주제 (선택)<input value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} className="mt-1 w-full rounded border border-border bg-background p-3" placeholder="일상, 여행, 취미" /></label></details>
    <Button disabled={busy || !enabled || !pendingPrompt && items.some((item) => item.kind === 'PROMPT' && ['QUEUED', 'RUNNING'].includes(item.status))} onClick={() => void run(async () => { await command('PROMPT', { id: crypto.randomUUID(), level, topic }); })}>{pendingPrompt ? '이전 문장 생성 요청 확인 · 재시도' : '연습 문장과 AI 음성 만들기'}</Button>
    {!enabled && <p role="status" className="text-sm">지금은 AI를 사용할 수 없어요. 녹음 보관과 영어 쓰기는 계속할 수 있어요.</p>}
    {items.filter((item) => item.kind === 'PROMPT').slice(0, 5).map((item) => <article key={item.id} className="space-y-2 border-t border-border pt-3"><p className="text-xs text-muted-foreground">AI가 만든 모범 음성 · {item.status === 'READY' ? '다시 들어도 같은 음성을 사용해요' : item.status === 'FAILED' ? '생성 실패' : '준비 중…'}</p><p className="break-words text-base">{item.reference_text}</p>{item.feedback?.summary && <p className="text-sm text-muted-foreground">{item.feedback.summary}</p>}<div className="flex flex-wrap gap-2">{item.status === 'READY' && <><Button variant="outline" disabled={busy || stopped} onClick={() => void run(() => remotePlay(item.id))}>모범 음성 듣기</Button><Button variant="outline" disabled={recording} onClick={() => setReference(item.reference_text)}>이 문장 연습</Button></>}{item.status === 'FAILED' && <Button variant="outline" disabled={busy || !enabled} onClick={() => void run(async () => { await command('RETRY', { id: item.id }); })}>다시 생성</Button>}</div></article>)}
    <label className="block text-sm font-medium">기준 문장 · 영상 선택 자막을 붙여 넣어도 돼요<textarea value={reference} disabled={recording} maxLength={2000} onChange={(e) => setReference(e.target.value)} className="mt-2 min-h-24 w-full rounded border border-border bg-background p-3" placeholder="비워 두면 자유 발화로 분석해요." /></label>
    {recording && <p role="status" className="sticky bottom-20 rounded bg-danger-soft p-3 text-xl font-semibold text-danger">녹음 중 {Math.floor(seconds)}초 · {Math.ceil(60 - seconds)}초 남음</p>}
    <div className="sticky bottom-2 z-10 flex flex-wrap gap-2 rounded-lg bg-card py-2"><Button disabled={busy || stopped} onClick={() => recording ? void stop() : void run(record)}>{recording ? '녹음 종료' : draft ? '다시 녹음' : '마이크 켜고 녹음'}</Button><Button variant="outline" onClick={() => void stop()}>음성 멈추기</Button><a className="min-h-11 px-3 py-2 text-sm underline" href="#learning-draft">말하기 어려워요 · 영어 쓰기</a></div>
    <p className="text-xs text-muted-foreground">최대 60초 · 10MiB. 녹음하면 영상이 먼저 멈춰요. 다시 녹음하면 새 녹음이 끝날 때 기존 미분석 녹음을 대체해요.</p>
    {saved && <p role="status" className="text-sm">{saved}</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {draft && preview && <div className="space-y-3 rounded-lg border border-border p-3"><p className="text-sm">분석 전 녹음 · {Math.ceil(draft.seconds)}초</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || stopped || recording} onClick={() => void run(() => play(draft.blob))}>내 녹음 듣기</Button><a className="min-h-11 px-3 py-2 text-sm underline" href={preview} download={`paceon-recording.${draft.blob.type.includes('mp4') ? 'm4a' : 'webm'}`}>녹음 내려받기</a><Button variant="outline" disabled={recording || busy} onClick={() => void persist(null)}>이 기기 녹음 삭제</Button></div><p className="text-xs text-muted-foreground">분석하기를 누르면 이 녹음을 AI 서비스로 전송해 전사와 피드백을 만들어요. 음성은 기본 30일 보관해요.</p><Button disabled={busy || !enabled || recording} onClick={() => void run(async () => { await stop(); const response = await apiFetch('/api/learning/speech/upload', { method: 'POST', headers: { 'Content-Type': draft.blob.type, 'x-speech-id': draft.id, 'x-workspace-id': workspaceId, 'x-session-id': draft.sessionId, 'x-reference-text': encodeURIComponent(draft.reference) }, body: draft.blob }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? '분석 요청을 보내지 못했어요. 녹음은 그대로 보관돼요.'); await persist(null); await reload(); })}>{busy ? '요청 중…' : '이 녹음 분석하기'}</Button></div>}
    {items.filter((item) => item.kind === 'RECORDING').map((item) => <SpeechResult key={`${item.id}:${item.status}`} item={item} busy={busy} onCommand={(action, extra) => run(async () => { await command(action, { id: item.id, ...extra }); })} onPlay={() => run(() => remotePlay(item.id))} />)}
  </section>;
}
function SpeechResult({ item, busy, onCommand, onPlay }: { item: LearningSpeech; busy: boolean; onCommand: (action: string, extra?: Record<string, unknown>) => Promise<void>; onPlay: () => Promise<void> }) {
  const [edit, setEdit] = useState(item.edited_text ?? item.original_text ?? '');
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const remaining = item.keep_audio || !item.expires_at ? null : Date.parse(item.expires_at) - Date.now();
    const timer = setTimeout(() => setExpired(remaining !== null && remaining <= 0), 0);
    const expiry = remaining !== null && remaining > 0 && remaining < 2147483647 ? setTimeout(() => setExpired(true), remaining) : undefined;
    return () => { clearTimeout(timer); clearTimeout(expiry); };
  }, [item.expires_at, item.keep_audio]);
  const audioGone = !!item.audio_deleted_at || expired;
  const differences = item.reference_text ? speechWordDifferences(item.reference_text, item.edited_text ?? item.original_text ?? '') : [];
  return <article className="space-y-3 border-t border-border pt-4"><p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString('ko-KR')} · {item.status === 'READY' ? '분석 완료' : item.status === 'FAILED' ? '분석 실패 · 짧거나 조용한 녹음은 다시 녹음해 주세요' : '분석 준비 중…'}</p>{item.reference_text && <p className="text-sm">기준 문장: {item.reference_text}</p>}{item.status === 'READY' && <><p className="whitespace-pre-wrap break-words text-sm">원래 인식 문장: {item.original_text}</p>{item.edited_text !== null && <p className="whitespace-pre-wrap break-words text-sm">내 수정 문장: {item.edited_text}</p>}<details><summary className="min-h-11 cursor-pointer py-3 text-sm">인식 문장 수정</summary><textarea aria-label="인식 문장 수정본" value={edit} maxLength={8000} onChange={(e) => setEdit(e.target.value)} className="min-h-24 w-full rounded border border-border bg-background p-3" /><Button disabled={busy} onClick={() => void onCommand('EDIT', { text: edit })}>수정본 저장 · 원문 유지</Button></details><p className="text-xs text-muted-foreground">음성 인식은 틀릴 수 있어요. 아래는 처음 300단어의 텍스트 차이 후보(최대 40개)이며 발음·억양 평가가 아니에요.</p>{item.reference_text ? <p className="flex flex-wrap gap-2 text-sm">{differences.length ? differences.map((difference, index) => <span key={index} className="rounded bg-muted px-2 py-1">{difference.kind === 'missing' ? '누락 후보' : '추가 후보'}: {difference.word}</span>) : '비교 범위에서 단어 차이가 없어요.'}</p> : <p className="text-sm">기준 문장 없는 자유 발화 · 원문 일치도는 제공하지 않아요.</p>}<p className="whitespace-pre-wrap text-sm">{item.feedback?.summary}</p>{item.feedback?.corrections.map((correction, index) => <p key={index} className="text-sm">{correction.original} → {correction.revised}<br />{correction.reason}</p>)}{item.feedback?.expressions.map((expression, index) => <p key={index} className="text-sm"><strong>{expression.phrase}</strong> · {expression.meaning}<br />{expression.example}</p>)}</>}<div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || audioGone} onClick={() => void onPlay()}>저장된 음성 듣기</Button>{item.status === 'FAILED' && <Button variant="outline" disabled={busy} onClick={() => void onCommand('RETRY')}>분석 재시도</Button>}<Button variant="outline" disabled={busy || audioGone} onClick={() => void onCommand('DELETE_AUDIO')}>음성만 삭제 · 인식문 유지</Button><Button variant="outline" disabled={busy} onClick={() => void onCommand('DELETE')}>음성과 기록 삭제</Button></div><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={item.keep_audio} disabled={busy || audioGone} onChange={(e) => void onCommand('KEEP', { keep: e.target.checked })} />음성 계속 보관 (기본 30일)</label></article>;
}
