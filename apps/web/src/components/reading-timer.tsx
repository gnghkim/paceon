'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { BookOpen, Square } from 'lucide-react';
import { useAuth } from './auth-provider';
import { useQuickRecord } from './quick-record';
import { Button } from './ui/button';
import {
  READING_TIMER_CAP_MINUTES,
  elapsedSeconds,
  formatElapsed,
  parseReadingTimer,
  readingTimerKey,
  timerResult,
  type ReadingTimer,
} from '@/lib/reading-timer';

interface TimerApi {
  /** 지금 재고 있는 책. 없으면 null이다. */
  running: ReadingTimer | null;
  start: (resourceId: string) => void;
  stop: () => void;
}

const TimerContext = createContext<TimerApi>({ running: null, start: () => {}, stop: () => {} });
export const useReadingTimer = () => useContext(TimerContext);

/**
 * 읽는 시간을 재고, 끝내면 그 시간을 채운 채로 독서 기록 창을 연다.
 * 시작 시각만 기기에 저장하므로 앱을 닫았다 열어도 이어진다.
 */
export function ReadingTimerProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const openRecord = useQuickRecord();
  const userId = session?.user.id ?? '';
  const [running, setRunning] = useState<ReadingTimer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [overCap, setOverCap] = useState<number | null>(null);

  const key = readingTimerKey(userId);

  // 저장된 타이머는 외부 상태다. 렌더 중이 아니라 붙은 뒤에 읽는다.
  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => {
      try {
        setRunning(parseReadingTimer(localStorage.getItem(key), Date.now()));
      } catch {
        /* 저장소를 못 쓰면 이번 방문에만 잰다. */
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [key, userId]);

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running]);

  const start = useCallback(
    (resourceId: string) => {
      const timer = { resourceId, startedAt: Date.now() };
      setRunning(timer);
      setNow(timer.startedAt);
      setOverCap(null);
      try {
        localStorage.setItem(key, JSON.stringify(timer));
      } catch {
        /* 저장하지 못해도 이 화면이 열려 있는 동안은 잰다. */
      }
    },
    [key],
  );

  const stop = useCallback(() => {
    if (!running) return;
    const result = timerResult(running, Date.now());
    setRunning(null);
    try {
      localStorage.removeItem(key);
    } catch {
      /* 이미 상태에서 지웠다. */
    }
    if (result.overCap) {
      // 끄는 것을 잊은 기록이 통계를 조용히 망가뜨리지 않게, 직접 확인하게 한다.
      setOverCap(result.seconds);
      openRecord(running.resourceId);
      return;
    }
    openRecord(running.resourceId, result.minutes ?? undefined);
  }, [running, key, openRecord]);

  return (
    <TimerContext value={{ running, start, stop }}>
      {running && (
        <div className="sticky top-16 z-20 border-b border-primary/30 bg-primary-soft">
          <div className="mx-auto flex max-w-[1216px] items-center justify-between gap-3 px-4 py-2.5 sm:px-8">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <BookOpen size={16} className="shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate">읽는 중</span>
              <span
                className="font-mono tabular-nums text-primary"
                role="timer"
                aria-label={`읽은 시간 ${formatElapsed(elapsedSeconds(running, now))}`}
              >
                {formatElapsed(elapsedSeconds(running, now))}
              </span>
            </span>
            <Button type="button" size="sm" onClick={stop}>
              <Square size={14} aria-hidden="true" />
              다 읽었어요
            </Button>
          </div>
        </div>
      )}
      {overCap !== null && (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-lg bg-warning-soft p-3 text-sm leading-6 sm:mx-8"
        >
          타이머가 {Math.floor(overCap / 3600)}시간 넘게 돌았어요. 실제로 읽은 시간을 직접
          입력해 주세요. {READING_TIMER_CAP_MINUTES / 60}시간이 넘으면 자동으로 채우지 않아요.
        </p>
      )}
      {children}
    </TimerContext>
  );
}

/** 이 책의 타이머를 시작하는 버튼. 다른 책을 재는 중이면 보이지 않는다. */
export function StartReadingButton({
  resourceId,
  className,
}: {
  resourceId: string;
  className?: string;
}) {
  const { running, start } = useReadingTimer();
  if (running) return null;
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        start(resourceId);
      }}
    >
      읽기 시작
    </Button>
  );
}
