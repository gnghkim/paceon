'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BookOpen, Pause, Play, Square } from 'lucide-react';
import { useAuth } from './auth-provider';
import { useQuickRecord } from './quick-record';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import {
  READING_TIMER_CAP_MINUTES,
  elapsedSeconds,
  formatElapsed,
  isPaused,
  newReadingTimer,
  parseReadingTimer,
  pauseTimer,
  readingTimerKey,
  resumeTimer,
  timerResult,
  type ReadingTimer,
} from '@/lib/reading-timer';

interface TimerApi {
  /** 지금 재고 있는 책. 없으면 null이다. */
  running: ReadingTimer | null;
  start: (resourceId: string, title?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
}

const noop = () => {};
const TimerContext = createContext<TimerApi>({
  running: null,
  start: noop,
  pause: noop,
  resume: noop,
  stop: noop,
});
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

  // 멈춰 있는 동안은 숫자가 움직이지 않으므로 시계도 돌리지 않는다.
  const ticking = running !== null && !isPaused(running);
  useEffect(() => {
    if (!ticking) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [ticking]);

  // 띠의 높이를 알려 둔다. 같은 자리에 붙는 다른 고정 요소가 그만큼 내려앉는다.
  const strip = useRef<HTMLDivElement>(null);
  const showing = running !== null;
  useEffect(() => {
    const root = document.documentElement;
    const element = strip.current;
    if (!showing || !element) return;
    const publish = () => root.style.setProperty('--reading-strip-h', `${element.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--reading-strip-h');
    };
  }, [showing]);

  const keep = useCallback(
    (timer: ReadingTimer) => {
      setRunning(timer);
      setNow(Date.now());
      try {
        localStorage.setItem(key, JSON.stringify(timer));
      } catch {
        /* 저장하지 못해도 이 화면이 열려 있는 동안은 잰다. */
      }
    },
    [key],
  );

  const start = useCallback(
    (resourceId: string, title?: string) => {
      setOverCap(null);
      keep(newReadingTimer(resourceId, Date.now(), title));
    },
    [keep],
  );

  const pause = useCallback(() => {
    if (running) keep(pauseTimer(running, Date.now()));
  }, [running, keep]);

  const resume = useCallback(() => {
    if (running) keep(resumeTimer(running, Date.now()));
  }, [running, keep]);

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

  const paused = running !== null && isPaused(running);
  const elapsed = running ? formatElapsed(elapsedSeconds(running, now)) : '';

  return (
    <TimerContext value={{ running, start, pause, resume, stop }}>
      {running && (
        <div
          ref={strip}
          className={cn(
            // 낮은 화면(가로로 눕힌 휴대폰)에서는 띠가 화면을 너무 가린다. 그때는 흘려보낸다.
            'sticky top-16 z-20 border-b [@media(max-height:600px)]:static',
            paused ? 'border-border bg-surface-subtle' : 'border-primary/30 bg-primary-soft',
          )}
        >
          <div className="mx-auto flex max-w-[1216px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <BookOpen
                size={22}
                className={cn('shrink-0', paused ? 'text-muted-foreground' : 'text-primary')}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">
                  {paused ? '잠시 멈춤' : '읽는 중'}
                  {running.title && ` · ${running.title}`}
                </p>
                <p
                  role="timer"
                  aria-label={`읽은 시간 ${elapsed}${paused ? ', 잠시 멈춤' : ''}`}
                  className={cn(
                    'font-mono text-3xl font-semibold leading-tight tabular-nums',
                    paused ? 'text-muted-foreground' : 'text-primary',
                  )}
                >
                  {elapsed}
                </p>
              </div>
            </div>
            <div className="flex w-full gap-2 sm:w-auto sm:shrink-0">
              {paused ? (
                <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={resume}>
                  <Play aria-hidden="true" />
                  이어 읽기
                </Button>
              ) : (
                <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={pause}>
                  <Pause aria-hidden="true" />
                  잠시 멈춤
                </Button>
              )}
              <Button type="button" className="flex-1 sm:flex-none" onClick={stop}>
                <Square aria-hidden="true" />
                다 읽었어요
              </Button>
            </div>
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

/**
 * 이 책의 타이머를 시작하는 버튼. 다른 책을 재는 중이면 보이지 않는다.
 *
 * 한 화면에서 채운 색은 하나만 쓴다. 다음에 할 일이 하나로 보여야 하기 때문이다.
 * 그래서 강조는 부르는 쪽이 정한다.
 */
export function StartReadingButton({
  resourceId,
  title,
  emphasis = 'quiet',
  className,
}: {
  resourceId: string;
  title?: string;
  /** primary는 채운 색, large는 책 상세처럼 단추 하나가 주인공인 자리다. */
  emphasis?: 'quiet' | 'primary' | 'large';
  className?: string;
}) {
  const { running, start } = useReadingTimer();
  if (running) return null;
  return (
    <Button
      type="button"
      variant={emphasis === 'quiet' ? 'outline' : 'default'}
      {...(emphasis === 'large' ? { size: 'lg' as const } : {})}
      className={cn(emphasis === 'large' && 'w-full sm:w-auto', className)}
      onClick={(event) => {
        event.stopPropagation();
        start(resourceId, title);
      }}
    >
      {/* 조용한 단추는 좁은 카드 안에서 제목과 자리를 다툰다. 아이콘은 강조할 때만 붙인다. */}
      {emphasis !== 'quiet' && <Play aria-hidden="true" />}
      읽기 시작
    </Button>
  );
}
