'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from './ui/button';
import { learningDuration } from './learning-types';

export interface PlaybackObservation {
  positionSeconds: number;
  durationSeconds: number;
  playing: boolean;
  rate: number;
}
interface Player {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setPlaybackRate(rate: number): void;
  pauseVideo(): void;
  playVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  destroy(): void;
}
interface YouTubeAPI {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => Player;
}
declare global {
  interface Window { YT?: YouTubeAPI; onYouTubeIframeAPIReady?: () => void }
}
let apiPromise: Promise<YouTubeAPI> | null = null;
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeAPI>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => { apiPromise = null; reject(new Error('YouTube 플레이어 연결 시간이 초과됐어요.')); }, 20000);
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      clearTimeout(timeout);
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { clearTimeout(timeout); apiPromise = null; reject(new Error('YouTube 플레이어를 불러오지 못했어요.')); };
    document.head.appendChild(script);
  });
  return apiPromise;
}

export function YouTubePlayer({ videoId, initialPosition, stopped, stopToken, seek, onObservation, onPosition, stopPlaybackRef }: {
  stopPlaybackRef: RefObject<(() => Promise<void>) | null>;
  videoId: string;
  initialPosition: number;
  stopped: boolean;
  stopToken: number;
  seek: { seconds: number; token: number } | null;
  onObservation: (value: PlaybackObservation) => Promise<boolean>;
  onPosition: (seconds: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const callbacks = useRef({ onObservation, onPosition, stopped });
  useEffect(() => { callbacks.current = { onObservation, onPosition, stopped }; }, [onObservation, onPosition, stopped]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [rates, setRates] = useState<number[]>([1]);
  const [rate, setRate] = useState(1);
  const [position, setPosition] = useState(initialPosition);
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const [shadowSeconds, setShadowSeconds] = useState(10);
  const [shadowMessage, setShadowMessage] = useState('');
  const shadowEnd = useRef<number | null>(null);
  const loop = useRef({ a, b });
  useEffect(() => { loop.current = { a, b }; }, [a, b]);
  useEffect(() => {
    const container = host.current;
    let disposed = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let lastReport = 0;
    let flushingBoundary = false;
    const report = async (force = false, halted = false) => {
      const p = player.current;
      if (!p || disposed) return;
      const seconds = p.getCurrentTime();
      setPosition(seconds);
      callbacks.current.onPosition(seconds);
      if (shadowEnd.current !== null && seconds >= shadowEnd.current) { shadowEnd.current = null; p.pauseVideo(); setShadowMessage('구간 듣기가 끝났어요. 아래 말하기 연습에서 녹음하세요.'); halted = true; }
      const playing = !halted && p.getPlayerState() === 1 && document.visibilityState === 'visible';
      if (playing && callbacks.current.stopped) { p.pauseVideo(); return; }
      const boundary = playing && loop.current.a !== null && loop.current.b !== null && seconds >= loop.current.b;
      // A short loop must settle its forward segment before the backward seek.
      // Pause/hidden observations still pass while that settlement is pending.
      if (playing && flushingBoundary) return;
      if (!force && !boundary && (!playing || Date.now() - lastReport < 10000)) return;
      const repeatFrom = boundary ? loop.current.a : null;
      if (boundary) flushingBoundary = true;
      lastReport = Date.now();
      try {
        const accepted = await callbacks.current.onObservation({ positionSeconds: seconds, durationSeconds: p.getDuration(), playing, rate: p.getPlaybackRate() });
        if (!accepted && !disposed) p.pauseVideo();
        if (accepted && repeatFrom !== null && !disposed && !callbacks.current.stopped && document.visibilityState === 'visible' && p.getPlayerState() === 1 && loop.current.a === repeatFrom && loop.current.b !== null)
          p.seekTo(repeatFrom, true);
      } finally {
        if (boundary) flushingBoundary = false;
      }
    };
    stopPlaybackRef.current = async () => { player.current?.pauseVideo(); await report(true, true); };
    const hide = () => { if (document.visibilityState === 'hidden') { player.current?.pauseVideo(); void report(true); } };
    void loadAPI().then((api) => {
      if (disposed || !host.current) return;
      const target = document.createElement('div');
      host.current.appendChild(target);
      player.current = new api.Player(target, {
        width: '100%', height: '100%', videoId,
        playerVars: { autoplay: 0, controls: 1, playsinline: 1, start: Math.floor(initialPosition), origin: window.location.origin },
        events: {
          onReady: () => { if (disposed) return; setReady(true); setRates(player.current?.getAvailablePlaybackRates() ?? [1]); interval = setInterval(() => void report(), 500); },
          onStateChange: () => void report(true),
          onPlaybackRateChange: () => { setRate(player.current?.getPlaybackRate() ?? 1); void report(true); },
          onError: (event: { data: number }) => { if (disposed) return; setError(`이 영상을 재생할 수 없어요 (YouTube ${event.data}). 비공개·삭제·임베드 제한 여부를 확인해 주세요.`); void report(true, true); },
        },
      });
    }).catch((e: Error) => { if (!disposed) setError(e.message); });
    document.addEventListener('visibilitychange', hide);
    return () => { disposed = true; stopPlaybackRef.current = null; clearInterval(interval); document.removeEventListener('visibilitychange', hide); player.current?.destroy(); player.current = null; container?.replaceChildren(); };
    // A saved-position update must never reconstruct a playing iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);
  useEffect(() => { if (stopped || stopToken > 0) { shadowEnd.current = null; player.current?.pauseVideo(); } }, [stopped, stopToken]);
  useEffect(() => { if (seek && ready) player.current?.seekTo(seek.seconds, true); }, [seek, ready]);
  return <section className="space-y-3" aria-label="YouTube 영상">
    <div ref={host} className="aspect-video min-h-[200px] w-full overflow-hidden rounded-xl bg-black [&_iframe]:h-full [&_iframe]:w-full" />
    {!ready && !error && <p role="status" className="text-sm">YouTube 플레이어를 불러오는 중…</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-mono">{learningDuration(position)}</span>
      <label>배속 <select aria-label="재생 배속" className="rounded border border-border bg-background p-2" value={rate} disabled={!ready} onChange={(e) => player.current?.setPlaybackRate(Number(e.target.value))}>{rates.map((r) => <option key={r} value={r}>{r}×</option>)}</select></label>
      <Button variant="outline" disabled={!ready} onClick={() => { setA(position); setB(null); }}>A 지정 {a !== null && learningDuration(a)}</Button>
      <Button variant="outline" disabled={!ready || a === null || position <= a} onClick={() => setB(position)}>B 지정 {b !== null && learningDuration(b)}</Button>
      {b !== null && <Button variant="outline" onClick={() => { setA(null); setB(null); }}>반복 해제</Button>}
      <a className="underline" href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(position)}s`} target="_blank" rel="noreferrer">YouTube에서 열기</a>
    </div>
    <div className="space-y-2 rounded-lg border border-border p-3">
      <h3 className="text-sm font-medium">짧은 구간 쉐도잉</h3>
      <p className="text-xs text-muted-foreground">현재 위치부터 5–30초 듣고 영상이 멈추면, 아래 말하기 연습에서 녹음하세요.</p>
      <div className="flex flex-wrap items-center gap-2"><label className="text-sm">구간 길이 <input type="number" min={5} max={30} value={shadowSeconds} onChange={(e) => setShadowSeconds(Number(e.target.value))} className="w-20 rounded border border-border bg-background p-2" />초</label><Button variant="outline" disabled={!ready || stopped || !Number.isFinite(shadowSeconds) || shadowSeconds < 5 || shadowSeconds > 30} onClick={() => { const p = player.current; if (!p) return; setA(null); setB(null); loop.current = { a: null, b: null }; shadowEnd.current = p.getCurrentTime() + shadowSeconds; setShadowMessage('선택 구간 듣는 중…'); p.playVideo(); }}>현재 위치부터 구간 듣기</Button><a href="#learning-speech" className="min-h-11 px-3 py-2 text-sm underline" onClick={() => { shadowEnd.current = null; player.current?.pauseVideo(); }}>영상 멈추고 말하기</a></div>
      {shadowMessage && <p role="status" className="text-sm">{shadowMessage}</p>}
    </div>
    <p className="text-xs text-muted-foreground">재생 버튼을 누르면 마지막 위치에서 이어 봐요. 외부 YouTube 시청 시간은 자동 기록하지 않아요.</p>
  </section>;
}
