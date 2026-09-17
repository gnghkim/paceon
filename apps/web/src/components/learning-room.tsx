'use client';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { SpeechPanel } from './speech-panel';
import { LearningJobCard } from './learning-job';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pause, Play, Send, Square } from 'lucide-react';
import { LearningVideoPanel } from './learning-video-panel';
import type { PlaybackObservation } from './youtube-player';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { DraftRecovery, SessionHistory } from './learning-room-sections';
import { mergeLearningPages, playResumesPause, resolveRoomTab, roomTabs, sessionTiming, timerStatusLabel, type LearningRoomTab } from './learning-room-view';
import { LearningRoomTabs } from './learning-room-tabs';
import { WordCatcher } from './word-catcher';
import { cn } from '@/lib/utils';
import { areaForKind, learningRoomFeatures, workspaceHref } from './learning-areas';
import { LegacySpeechRecords } from './legacy-speech-records';
import {
  learningDuration,
  type LearningSnapshot,
  type LearningSession,
  type LearningWorkspace,
  type LearningMessage,
  type LearningKind,
} from './learning-types';

type Draft = { text: string; version: number };
type Command = Record<string, unknown> & { action: string };
class LearningError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function LearningRoom({ id }: { id: string }) {
  const { apiFetch, session: auth } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<LearningSnapshot | null>(null);
  const [history, setHistory] = useState<LearningSnapshot[]>([]);
  const [draft, setDraft] = useState('');
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [saveStatus, setSaveStatus] = useState('불러오는 중');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [current, setCurrent] = useState<LearningSession | null>(null);
  const [now, setNow] = useState(0);
  const [stopToken, setStopToken] = useState(0);
  // 단어 담기는 탭에 따라 자리를 옮기며 다시 그려진다. 열림과 개수는 여기 남는다.
  const [catcherOpen, setCatcherOpen] = useState(false);
  const [caught, setCaught] = useState(0);
  const searchParams = useSearchParams();
  const [recording, setRecording] = useState(false);
  const onRecordingChange = useCallback((value: boolean) => setRecording(value), []);
  const observations = useRef(Promise.resolve(true));
  const stopSpeechRef = useRef<(() => Promise<void>) | null>(null);
  const speechObservations = useRef(Promise.resolve<string | null>(null));
  const stopPlaybackRef = useRef<(() => Promise<void>) | null>(null);
  const [view, setView] = useState({
    device: '',
    lastActivity: 0,
    pendingEnd: false,
  });
  const state = useRef({
    draft: '',
    version: 0,
    saved: '',
    ready: false,
    conflict: false,
    kind: null as LearningKind | null,
    device: '',
    lastActivity: 0,
    lastTextActivity: 0,
    videoPlaying: false,
    speechPlaying: false,
    stopMedia: false,
    session: null as LearningSession | null,
    blocked: false,
    busy: false,
    pendingEnd: false,
  });
  const saving = useRef<Promise<boolean> | null>(null);
  const starting = useRef<Promise<LearningSession | null> | null>(null);
  const pending = useRef(new Map<string, Command>());
  const key = `paceon:learning:${auth?.user.id}:${id}`;
  const local = useCallback(() => {
    if (!state.current.ready || state.current.conflict) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          text: state.current.draft,
          version: state.current.version,
        }),
      );
    } catch {
      setSaveStatus('이 기기에 저장할 수 없어요. 클라우드 저장을 확인하세요.');
    }
  }, [key]);
  const acceptSession = useCallback((s: LearningSession) => {
    const old = state.current.session;
    if (old && old.id !== s.id && old.started_at >= s.started_at) return;
    if (old?.id === s.id && old.generation > s.generation) return;
    if (old?.id === s.id && old.updated_at > s.updated_at) return;
    state.current.session = s;
    state.current.blocked =
      s.status !== 'ENDED' && s.device_id !== state.current.device;
    setLocked(state.current.blocked);
    setCurrent(s);
  }, []);
  const command = useCallback(
    async <T,>(payload: Command): Promise<T> => {
      const signature = JSON.stringify(payload);
      // END and MESSAGE must survive a reload so a retry reuses the same requestId.
      const persisted = payload.action === 'END' || payload.action === 'MESSAGE';
      const storageKey = `${key}:pending:${payload.action}`;
      let request = pending.current.get(signature);
      if (persisted) {
        try {
          const raw = sessionStorage.getItem(storageKey);
          if (raw) request = JSON.parse(raw) as Command;
        } catch {
          /* Keep in-memory retry. */
        }
      }
      if (!request) {
        request = { ...payload, requestId: crypto.randomUUID() };
        pending.current.set(signature, request);
      }
      if (persisted) {
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(request));
        } catch {
          /* Retry remains in memory. */
        }
      }
      const res = await apiFetch('/api/learning/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        keepalive: payload.action === 'PAUSE',
      });
      const body = await res.json();
      const forgetRequest = () => {
        for (const [entry, saved] of pending.current) {
          if (saved.requestId === request.requestId) pending.current.delete(entry);
        }
        if (!persisted) return;
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          /* Storage may be unavailable. */
        }
      };
      // 5xx keeps the request so the next attempt is an idempotent retry.
      if (res.ok || res.status < 500) forgetRequest();
      if (!res.ok)
        throw new LearningError(
          body.error ?? '연결을 확인하고 다시 시도해 주세요.',
          res.status,
        );
      return body as T;
    },
    [apiFetch, key],
  );
  const reload = useCallback(async () => {
    const res = await apiFetch(`/api/learning/workspaces/${id}`, {
      cache: 'no-store',
    });
    if (!res.ok)
      throw new LearningError(
        '영어학습을 불러오지 못했어요. 로그인과 연결을 확인해 주세요.',
        res.status,
      );
    const body = (await res.json()) as LearningSnapshot;
    setData(body);
    state.current.kind = body.workspace.kind;
    if (!state.current.ready) {
      state.current.ready = true;
      state.current.version = body.workspace.draft_version;
      state.current.saved = body.workspace.draft;
      state.current.draft = body.workspace.draft;
      setDraft(body.workspace.draft);
      setSaveStatus('저장됨');
      // Rooms without a writing feature never show DraftRecovery, so a stale
      // local draft there must not block END/flush behind an invisible prompt.
      if (learningRoomFeatures(body.workspace.kind).writing) {
        try {
          const raw = localStorage.getItem(key);
          const saved = raw ? (JSON.parse(raw) as Draft) : null;
          if (
            saved &&
            typeof saved.text === 'string' &&
            saved.text !== body.workspace.draft
          ) {
            state.current.conflict = true;
            setRecovery(saved);
            setSaveStatus('이 기기의 초안 확인 필요');
          }
        } catch {
          /* Invalid local data never replaces cloud content. */
        }
      }
    }
    const latest = body.sessions
      .slice()
      .sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
    if (latest) {
      acceptSession(latest);
      if (latest.status === 'ENDED') {
        state.current.pendingEnd = false;
        try { sessionStorage.removeItem(`${key}:pending:END`); } catch { /* Retry remains in memory. */ }
      }
    }
  }, [apiFetch, id, key, acceptSession]);
  const flush = useCallback(
    async function flushDraft(): Promise<boolean> {
      if (saving.current) {
        await saving.current;
        return flushDraft();
      }
      // Rooms without a writing feature have no draft to flush and must
      // never be blocked by draft state (e.g. a pre-split SPEAKING room
      // that still has an unsynced localStorage draft).
      if (state.current.kind && !learningRoomFeatures(state.current.kind).writing)
        return true;
      if (!state.current.ready || state.current.conflict) return false;
      if (state.current.draft === state.current.saved) return true;
      const text = state.current.draft;
      const version = state.current.version;
      setSaveStatus('저장 중…');
      const operation = (async () => {
        try {
          const { workspace } = await command<{ workspace: LearningWorkspace }>(
            {
              action: 'SAVE_DRAFT',
              workspaceId: id,
              expectedVersion: version,
              draft: text,
            },
          );
          state.current.version = workspace.draft_version;
          state.current.saved = text;
          local();
          setSaveStatus(state.current.draft === text ? '저장됨' : '저장 대기');
          return true;
        } catch (e) {
          setSaveStatus('동기화 대기 · 초안은 이 기기에 보관');
          if (e instanceof LearningError && e.status === 409) {
            state.current.conflict = true;
            setRecovery({ text: state.current.draft, version });
            setError(
              '다른 곳에서 수정한 글이 있어요. 최신 글을 확인한 뒤 복원해 주세요.',
            );
          }
          return false;
        }
      })();
      saving.current = operation;
      const result = await operation;
      saving.current = null;
      if (result && state.current.draft !== state.current.saved)
        return flushDraft();
      return result;
    },
    [command, id, local],
  );
  const start = useCallback(
    async (takeover = false): Promise<LearningSession | null> => {
      if (starting.current) return starting.current;
      if (
        !state.current.ready ||
        state.current.pendingEnd ||
        (state.current.blocked && !takeover)
      )
        return null;
      const operation = (async () => {
        try {
          const { session } = await command<{ session: LearningSession }>({
            action: takeover ? 'TAKEOVER' : 'START',
            workspaceId: id,
            deviceId: state.current.device,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          });
          acceptSession(session);
          return session;
        } catch (e) {
          setError((e as Error).message);
          if (e instanceof LearningError && e.status === 409) {
            state.current.blocked = true;
            setLocked(true);
          }
          return null;
        }
      })();
      starting.current = operation;
      const result = await operation;
      starting.current = null;
      return result;
    },
    [command, id, acceptSession],
  );
  const activity = () => {
    state.current.lastTextActivity = Date.now();
    state.current.lastActivity = Date.now();
    const s = state.current.session;
    if (
      !s ||
      s.status === 'ENDED' ||
      (s.status === 'ACTIVE' && Date.parse(s.lease_expires_at) <= Date.now()) ||
      (s.status === 'PAUSED' && s.pause_reason !== 'MANUAL')
    )
      void start();
  };
  const transition = useCallback(
    async (action: 'PAUSE' | 'END' | 'HEARTBEAT', reason?: string) => {
      const s = state.current.session;
      if (!s || s.status === 'ENDED' || state.current.blocked) return;
      const active =
        document.visibilityState === 'visible' &&
        Date.now() - state.current.lastActivity < 60_000;
      try {
        const result = await command<{ session: LearningSession }>({
          action,
          sessionId: s.id,
          deviceId: state.current.device,
          generation: s.generation,
          activity: active,
          ...(reason ? { reason } : {}),
        });
        acceptSession(result.session);
        if (action === 'END') state.current.pendingEnd = false;
      } catch (e) {
        setError(
          action === 'END'
            ? '종료 동기화 대기 중입니다. 다시 종료를 누르면 같은 요청을 재전송해요.'
            : (e as Error).message,
        );
        if (e instanceof LearningError && e.status === 409) {
          state.current.blocked = true;
          setLocked(true);
        }
        throw e;
      }
    },
    [acceptSession, command],
  );
  useEffect(() => {
    // sessionStorage preserves navigation/reloads. A fresh tab gets a distinct lease identity.
    const runtime = state.current;
    const storageKey = `paceon:learning-device:${auth?.user.id}`;
    try {
      state.current.device =
        sessionStorage.getItem(storageKey) || crypto.randomUUID();
      sessionStorage.setItem(storageKey, state.current.device);
    } catch {
      state.current.device = crypto.randomUUID();
    }
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(storageKey);
    const instance = crypto.randomUUID();
    const born = Date.now();
    if (channel) {
      channel.onmessage = (
        event: MessageEvent<{ device: string; instance: string; born: number }>,
      ) => {
        const other = event.data;
        if (
          other.device !== state.current.device ||
          other.instance === instance
        )
          return;
        if (
          other.born < born ||
          (other.born === born && other.instance < instance)
        ) {
          state.current.device = crypto.randomUUID();
          try {
            sessionStorage.setItem(storageKey, state.current.device);
          } catch {
            /* Keep the unique in-memory identity. */
          }
          if (state.current.session) acceptSession(state.current.session);
        } else
          channel.postMessage({ device: state.current.device, instance, born });
      };
      channel.postMessage({ device: state.current.device, instance, born });
    }
    for (const action of ['END', 'MESSAGE']) {
      try {
        const raw = sessionStorage.getItem(`${key}:pending:${action}`);
        if (raw) {
          const request = JSON.parse(raw) as Command;
          const { requestId: _requestId, ...payload } = request;
          void _requestId;
          pending.current.set(JSON.stringify(payload), request);
          if (action === 'END') state.current.pendingEnd = true;
        }
      } catch {
        /* Ignore damaged retry state. */
      }
    }
    void reload().catch((e) => setError((e as Error).message));
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible')
        void reload().catch(() =>
          setError('연결이 끊겼어요. 저장과 시간 동기화 상태를 확인해 주세요.'),
        );
    }, 5000);
    const tick = window.setInterval(() => {
      setNow(Date.now());
      const { device, lastActivity, pendingEnd } = state.current;
      setView({ device, lastActivity, pendingEnd });
    }, 1000);
    const beat = window.setInterval(() => {
      const s = state.current.session;
      if (
        s?.status !== 'ACTIVE' ||
        state.current.videoPlaying ||
        state.current.speechPlaying ||
        state.current.pendingEnd ||
        document.visibilityState !== 'visible'
      )
        return;
      void transition(
        Date.now() - state.current.lastActivity >= 60_000
          ? 'PAUSE'
          : 'HEARTBEAT',
        Date.now() - state.current.lastActivity >= 60_000 ? 'IDLE' : undefined,
      ).catch(() => {});
    }, 15000);
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        state.current.stopMedia = true;
        state.current.videoPlaying = false;
        setStopToken((value) => value + 1);
        local();
        void flush();
        if (state.current.session?.status === 'ACTIVE')
          void (async () => { await stopSpeechRef.current?.(); await stopPlaybackRef.current?.(); await transition('PAUSE', 'HIDDEN'); })().catch(() => {});
      }
    };
    const unload = (e: BeforeUnloadEvent) => {
      local();
      if (
        state.current.draft !== state.current.saved ||
        state.current.pendingEnd
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('beforeunload', unload);
    return () => {
      channel?.close();
      clearInterval(poll);
      clearInterval(tick);
      clearInterval(beat);
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('beforeunload', unload);
      local();
      if (runtime.session?.status === 'ACTIVE') {
        runtime.stopMedia = true;
        runtime.videoPlaying = false;
        // This imperative controller is installed after the snapshot loads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        void (async () => { await stopSpeechRef.current?.(); await stopPlaybackRef.current?.(); await transition('PAUSE', 'HIDDEN'); })().catch(() => {});
      }
    };
  }, [auth?.user.id, key, reload, flush, transition, local, acceptSession]);
  useEffect(() => {
    if (!state.current.ready || state.current.conflict) return;
    const timeout = setTimeout(() => {
      void flush();
    }, 3000);
    return () => clearTimeout(timeout);
  }, [draft, flush]);
  const observeSpeech = (phase: 'prepare' | 'active' | 'stop'): Promise<string | null> => {
    const operation = speechObservations.current.then(async () => {
      const runtime = state.current;
      if (phase === 'prepare' && !runtime.busy && !runtime.pendingEnd && !runtime.blocked && runtime.session?.pause_reason !== 'MANUAL' && document.visibilityState === 'visible') runtime.stopMedia = false;
      if (phase !== 'stop' && (runtime.blocked || runtime.stopMedia || runtime.pendingEnd || document.visibilityState !== 'visible')) return null;
      let session = runtime.session;
      if (phase === 'prepare') { session = await start(); return session?.id ?? null; }
      if (!session || session.status === 'ENDED' || runtime.blocked) return null;
      const playing = phase === 'active';
      runtime.speechPlaying = playing;
      runtime.lastActivity = playing ? Date.now() : runtime.lastTextActivity;
      try {
        const response = await apiFetch('/api/learning/speech/commands', { method: 'POST', keepalive: phase === 'stop', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'SPEECH_TICK', requestId: crypto.randomUUID(), sessionId: session.id, deviceId: runtime.device, generation: session.generation, playing }) });
        const body = await response.json();
        if (!response.ok) { if (response.status === 409) { runtime.blocked = true; setLocked(true); } throw new Error(body.error ?? '말하기 시간을 동기화하지 못했어요.'); }
        acceptSession(body.session);
        return runtime.blocked ? null : body.session.id;
      } catch (e) { runtime.speechPlaying = false; setError((e as Error).message); return null; }
    });
    speechObservations.current = operation.catch(() => null);
    return operation;
  };
  const observeVideo = (observation: PlaybackObservation): Promise<boolean> => {
    // Only a new visible player event may resume a pause, a manual one included.
    // Already queued observations cannot clear a subsequent explicit stop.
    if (observation.playing && !state.current.busy &&
        playResumesPause(state.current.session, document.visibilityState === 'visible'))
      state.current.stopMedia = false;
    const operation = observations.current.then(async () => {
      const runtime = state.current;
      if (observation.playing) await stopSpeechRef.current?.();
      runtime.videoPlaying = observation.playing && document.visibilityState === 'visible';
      if (runtime.blocked || (observation.playing && (runtime.stopMedia || runtime.pendingEnd))) {
        runtime.videoPlaying = false;
        return false;
      }
      let session = runtime.session;
      if (runtime.videoPlaying) {
        runtime.lastActivity = Date.now();
        if (!session || session.status !== 'ACTIVE') session = await start();
      } else runtime.lastActivity = runtime.lastTextActivity;
      if (!session || session.status === 'ENDED') return !observation.playing;
      try {
        if (!runtime.stopMedia && !runtime.videoPlaying && Date.now() - runtime.lastTextActivity < 60000)
          await transition('HEARTBEAT');
        const response = await apiFetch('/api/learning/videos/commands', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: !observation.playing,
          body: JSON.stringify({ action: 'VIDEO_TICK', requestId: crypto.randomUUID(), sessionId: session.id, deviceId: runtime.device, generation: session.generation, ...observation, playing: runtime.videoPlaying }),
        });
        const body = await response.json();
        if (!response.ok) {
          if (response.status === 409) { runtime.blocked = true; setLocked(true); }
          throw new Error(body.error ?? '영상 위치를 동기화하지 못했어요. 연결을 확인해 주세요.');
        }
        acceptSession(body.session);
        return !runtime.blocked && body.session.pause_reason !== 'MANUAL';
      } catch (e) { runtime.videoPlaying = false; setError((e as Error).message); return false; }
    });
    observations.current = operation.catch(() => false);
    return observations.current;
  };
  async function run(action: () => Promise<void>) {
    if (state.current.busy) return;
    state.current.busy = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      state.current.busy = false;
      setBusy(false);
    }
  }
  async function send() {
    if (!(await flush()))
      throw new Error(
        '먼저 초안을 동기화해 주세요. 글은 그대로 보관되어 있어요.',
      );
    let s = state.current.session;
    if (!s || s.status === 'ENDED') s = await start();
    if (!s || s.status !== 'ACTIVE')
      throw new Error('학습 재개를 누른 뒤 보내 주세요.');
    const text = state.current.draft;
    if (!text.trim()) return;
    const result = await command<{ message: LearningMessage }>({
      action: 'MESSAGE',
      workspaceId: id,
      sessionId: s.id,
      content: text,
      deviceId: state.current.device,
      generation: s.generation,
    });
    if (state.current.draft === result.message.content) {
      state.current.draft = '';
      setDraft('');
      local();
      await flush();
    }
    await reload();
  }
  async function resolveDraft(useLocal: boolean) {
    const res = await apiFetch(`/api/learning/workspaces/${id}`, {
      cache: 'no-store',
    });
    if (!res.ok) throw new Error('최신 초안을 확인하지 못했어요.');
    const body = (await res.json()) as LearningSnapshot;
    if (
      useLocal &&
      body.workspace.draft_version !== data?.workspace.draft_version
    ) {
      setData(body);
      setError(
        '클라우드 글이 다시 변경되었어요. 최신 글을 확인한 뒤 다시 복원해 주세요.',
      );
      return;
    }
    state.current.version = body.workspace.draft_version;
    state.current.saved = body.workspace.draft;
    state.current.draft = useLocal ? recovery!.text : body.workspace.draft;
    state.current.conflict = false;
    setDraft(state.current.draft);
    setRecovery(null);
    local();
    setSaveStatus('저장 대기');
    await flush();
  }
  const canonical = data ? workspaceHref(data.workspace) : null;
  useEffect(() => {
    if (canonical && pathname !== canonical) router.replace(canonical);
  }, [canonical, pathname, router]);
  const resolvedTab = data ? resolveRoomTab(data.workspace.kind, searchParams.get('view')) : null;
  const tabHref = (next: LearningRoomTab) =>
    data && next === roomTabs(data.workspace.kind)[0]!.id ? canonical! : `${canonical}?view=${next}`;
  const lastTab = useRef<LearningRoomTab | null>(null);
  useEffect(() => {
    const previous = lastTab.current;
    lastTab.current = resolvedTab;
    if (previous === 'video' && resolvedTab !== null && resolvedTab !== 'video') {
      state.current.videoPlaying = false;
      void stopPlaybackRef.current?.();
    }
  }, [resolvedTab]);
  useEffect(() => {
    if (!data || !canonical || resolvedTab === null) return;
    const raw = searchParams.get('view');
    if (raw !== null && raw !== resolvedTab)
      router.replace(resolvedTab === roomTabs(data.workspace.kind)[0]!.id ? canonical : `${canonical}?view=${resolvedTab}`);
  }, [data, canonical, resolvedTab, searchParams, router]);
  if (!data)
    return (
      <div className="space-y-4">
        <Link href="/learn">← 영어학습</Link>
        <p role={error ? 'alert' : 'status'}>
          {error || '영어학습을 불러오는 중…'}
        </p>
        {error && (
          <Button
            onClick={() => void reload().catch((e) => setError(e.message))}
          >
            다시 불러오기
          </Button>
        )}
      </div>
    );
  const features = learningRoomFeatures(data.workspace.kind);
  const tabs = roomTabs(data.workspace.kind);
  const tab = resolvedTab!;
  const selectTab = (next: LearningRoomTab) => router.replace(tabHref(next));
  const area = areaForKind(data.workspace.kind);
  const { provisional, stale } = sessionTiming(current, view, now);
  const inflight = data.jobs.some(
    (j) =>
      j.kind === 'WRITING_REPLY' && ['QUEUED', 'RUNNING'].includes(j.status),
  );
  const { messages, jobs, sessions, videoNotes, videoVisits, hasMore } =
    mergeLearningPages([data, ...history]);
  // 보고 있는 것 바로 밑에 놓는다. 영상이 가려진 탭에서는 탭 밑으로 내려온다.
  const showVideo =
    Boolean(features.video && data.video) && (tab === 'video' || tab === 'source');
  const catcher = (
    <WordCatcher
      workspaceId={id}
      onActivity={activity}
      open={catcherOpen}
      onOpenChange={setCatcherOpen}
      saved={caught}
      onSaved={() => setCaught((count) => count + 1)}
    />
  );
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link
          href={`/learn/${area.slug}`}
          className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {area.label}
        </Link>
        <h1 className="text-2xl font-semibold">{data.workspace.title}</h1>
      </header>
      <section
        aria-label="학습 시간"
        className="sticky top-16 z-10 rounded-xl border border-border bg-surface p-4 shadow-sm [@media(max-height:600px)]:static"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">이번 학습</p>
            <p className="mt-1 font-mono text-2xl tabular-nums">
              {learningDuration((current?.elapsed_seconds ?? 0) + provisional)}
            </p>
            <p className="text-xs text-muted-foreground">
              {timerStatusLabel({
                locked,
                pendingEnd: view.pendingEnd,
                current,
                stale,
                kind: data.workspace.kind,
              })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {current?.status === 'ACTIVE' && !stale ? (
              <Button
                variant="outline"
                disabled={busy || locked}
                onClick={() =>
                  void run(async () => {
                    setStopToken((value) => value + 1);
                    state.current.stopMedia = true;
                    state.current.videoPlaying = false;
                    await stopSpeechRef.current?.();
                    await stopPlaybackRef.current?.();
                    await flush();
                    await transition('PAUSE', 'MANUAL');
                  })
                }
              >
                <Pause aria-hidden="true" />
                일시 정지
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={busy || locked || view.pendingEnd}
                onClick={() =>
                  void run(async () => {
                    state.current.lastActivity = Date.now();
                    state.current.stopMedia = false;
                    await start();
                  })
                }
              >
                <Play aria-hidden="true" />
                {current?.status === 'PAUSED' || stale
                  ? '학습 재개'
                  : '학습 시작'}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={
                busy || locked || !current || current.status === 'ENDED'
              }
              onClick={() =>
                void run(async () => {
                  setStopToken((value) => value + 1);
                  state.current.stopMedia = true;
                  state.current.videoPlaying = false;
                  await stopSpeechRef.current?.();
                    await stopPlaybackRef.current?.();
                  if (!(await flush()))
                    throw new Error('초안 저장을 확인한 뒤 종료해 주세요.');
                  state.current.pendingEnd = true;
                  try {
                    await transition('END');
                  } catch {
                    throw new Error(
                      '종료 동기화 대기 중입니다. 다시 종료를 눌러 주세요.',
                    );
                  }
                })
              }
            >
              <Square aria-hidden="true" />
              학습 종료
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          학습 시간은 자동 저장돼요. 1분간 활동이 없거나 화면을 벗어나면 멈춰요.
        </p>
      </section>
      <LearningRoomTabs tabs={tabs} current={tab} blocked={recording} onSelect={selectTab} />
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft p-4 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {locked && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <p className="text-sm">
            다른 탭이나 기기가 시간을 기록하고 있어요. 이곳으로 옮기면 이전
            기기의 기록이 멈춥니다.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                state.current.lastActivity = Date.now();
                state.current.stopMedia = false;
                await start(true);
              })
            }
          >
            이 기기로 학습 옮기기
          </Button>
        </div>
      )}
      {!showVideo && catcher}
      {features.video && data.video && (
        <div className={cn(tab === 'video' || tab === 'source' ? undefined : 'hidden')}>
          <LearningVideoPanel
            afterPlayer={showVideo ? catcher : null}
            video={data.video} title={data.workspace.title}
            tab={tab}
            notes={videoNotes}
            visits={videoVisits}
            stopped={locked || view.pendingEnd}
            stopToken={stopToken} stopPlaybackRef={stopPlaybackRef} onObservation={observeVideo} activity={activity} reload={reload}
          />
        </div>
      )}
      {features.speech && tab === 'speak' && <SpeechPanel workspaceId={id} ownerId={auth!.user.id} stopped={locked || view.pendingEnd || current?.pause_reason === 'MANUAL'} stopToken={stopToken} stopSpeechRef={stopSpeechRef} onMedia={observeSpeech} stopVideo={async () => { await stopPlaybackRef.current?.(); }} onRecordingChange={onRecordingChange} writingLink={features.writing} />}
      {features.legacySpeech && tab === 'ask' && <LegacySpeechRecords workspaceId={id} />}
      {features.writing && tab === 'ask' && (<>
      {recovery && (
        <DraftRecovery
          localText={recovery.text}
          cloudText={data.workspace.draft}
          busy={busy}
          onRestore={() => void run(() => resolveDraft(true))}
          onUseCloud={() => void run(() => resolveDraft(false))}
        />
      )}
      <section className="space-y-3 rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">{data.video ? '영상에 관해 질문하기' : '한 문장부터 써 보세요'}</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {data.video ? 'AI는 저장한 선택 자막과 메모에 근거해 답해요. 영상을 직접 시청하지 않으며, 자막이 없으면 내 메모와 질문만 참고해요.' : data.workspace.prompt ||
            '오늘 있었던 일이나 떠오르는 생각을 영어로 적어 보세요.'}
        </p>
        <label htmlFor="learning-draft" className="sr-only">
          영어 쓰기 초안
        </label>
        <textarea
          id="learning-draft"
          disabled={!!recovery}
          value={draft}
          maxLength={8000}
          onChange={(e) => {
            state.current.draft = e.target.value;
            setDraft(e.target.value);
            setSaveStatus('저장 대기');
            local();
            activity();
          }}
          onKeyDown={activity}
          onPointerDown={activity}
          className="min-h-56 w-full resize-y rounded-lg border border-border bg-background p-4 text-base leading-7 focus-visible:outline-2 focus-visible:outline-primary"
          placeholder={data.video ? '이 표현은 어떤 뜻인가요?' : 'Today, I…'}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-xs text-muted-foreground">
            {saveStatus} · {draft.length.toLocaleString()}/8,000
          </p>
          <Button variant="outline" onClick={() => void flush()}>
            지금 저장
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          AI에게 보내기를 누르면 작성한 글과 이 공간의 대화가 AI 서비스에
          전달돼요. AI 피드백은 틀릴 수 있어요. 자동 정리는 꺼져 있으며, 종료할
          때 자동 전송하지 않아요.
        </p>
        {!data.aiEnabled && (
          <p role="status" className="text-sm text-muted-foreground">
            지금은 AI를 사용할 수 없어요. 글과 학습 기록은 계속 저장돼요.
          </p>
        )}
        <Button
          className="min-h-11"
          disabled={
            busy ||
            !data.aiEnabled ||
            !draft.trim() ||
            inflight ||
            locked ||
            !!recovery ||
            view.pendingEnd
          }
          onClick={() => void run(send)}
        >
          <Send aria-hidden="true" />
          {inflight ? 'AI 피드백 준비 중…' : 'AI에게 보내기'}
        </Button>
      </section>
      <section
        id="learning-notes"
        className="scroll-mt-56 space-y-4"
        onPointerDown={() => {
          if (state.current.session && state.current.session.status !== 'ENDED')
            activity();
        }}
        onKeyDown={() => {
          if (state.current.session && state.current.session.status !== 'ENDED')
            activity();
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">대화와 학습 노트</h2>
          <Button
            variant="outline"
            disabled={
              busy ||
              !data.aiEnabled ||
              !current ||
              !(data.video && (data.video.context_end > data.video.context_start || !!data.videoNotes?.length)) && !data.messages.some(
                (m) => m.role === 'USER' && m.session_id === current.id,
              )
            }
            onClick={() =>
              void run(async () => {
                if (!(await flush()))
                  throw new Error('먼저 초안을 저장해 주세요.');
                await command({
                  action: 'SUMMARY',
                  workspaceId: id,
                  sessionId: current!.id,
                });
                await reload();
              })
            }
          >
            {data.video ? (data.video.context_end > data.video.context_start ? '선택 원문 정리하기' : '내 메모 정리하기') : '이번 학습 정리하기'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          정리하기는 AI에 보낸 이번 학습의 대화를 사용해요. 보내지 않은 초안은
          포함하지 않아요.
        </p>
        {!data.messages.length && (
          <p className="py-6 text-sm text-muted-foreground">
            보낸 글과 AI 피드백이 여기에 남아요.
          </p>
        )}
        {messages
          .filter((m) => m.role === 'USER')
          .map((m) => (
            <article
              key={m.id}
              className="rounded-xl border border-border bg-card p-5"
            >
              <p className="mb-3 text-xs font-medium text-primary">
                내가 쓴 글 · {new Date(m.created_at).toLocaleString('ko-KR')}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm leading-7">
                {m.content}
              </p>
            </article>
          ))}
        {jobs.map((j) => (
          <LearningJobCard
            key={j.id}
            job={j}
            workspaceId={id}
            disabled={busy || !data.aiEnabled}
            retry={() =>
              void run(async () => {
                await command({ action: 'RETRY', jobId: j.id });
                await reload();
              })
            }
          />
        ))}
      </section>
      </>)}
      {tab === 'ask' && hasMore && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const res = await apiFetch(
                `/api/learning/workspaces/${id}?page=${history.length + 1}`,
                { cache: 'no-store' },
              );
              if (!res.ok) throw new Error('이전 기록을 불러오지 못했어요.');
              const page = (await res.json()) as LearningSnapshot;
              setHistory((previous) => [...previous, page]);
            })
          }
        >
          이전 기록 더 보기
        </Button>
      )}
      <SessionHistory sessions={sessions} />
    </div>
  );
}
