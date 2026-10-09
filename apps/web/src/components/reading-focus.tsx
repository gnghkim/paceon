'use client';

import { useEffect, useRef } from 'react';
import { Minimize2, Pause, Play, Square, TextQuote } from 'lucide-react';
import { Button } from './ui/button';
import { useWorkspace } from './workspace-data';
import { describePosition, readingPosition } from '@/lib/reading-timer';
import { cn } from '@/lib/utils';

/**
 * 독서 타이머의 집중 화면. 읽은 시간만 화면 가득 보여 준다.
 *
 * 타이머를 켜면 폰은 책 옆에 놓인다. 그 거리에서 흘끗 봐도 읽혀야 하고,
 * 볼 때 화면이 꺼져 있으면 안 된다. 그래서 열려 있고 시간이 가는 동안에는
 * 화면을 켜 둔다. 멈췄거나 닫았으면 기기의 절전에 맡긴다.
 *
 * 닫아도 타이머는 계속 간다. 이 화면은 시계를 보는 창일 뿐이다.
 */
export function ReadingFocus({
  open,
  title,
  resourceId,
  studying = false,
  elapsed,
  paused,
  onClose,
  onPause,
  onResume,
  onStop,
  onQuote,
}: {
  open: boolean;
  title: string | undefined;
  /** 쪽으로 읽는 책이면 넘긴다. 어디부터 읽는지 보여 준다. */
  resourceId?: string | undefined;
  /** 책이 아니라 챕터(강의, 교재의 Unit)를 재는 중이면 읽는다는 말을 쓰지 않는다. */
  studying?: boolean;
  elapsed: string;
  paused: boolean;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  /** 쪽으로 읽는 책이면 문장을 남길 수 있다. 입력창은 이 화면 위에 뜨고, 닫으면 이 화면으로 돌아온다. */
  onQuote?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // 모달은 뒤 페이지의 스크롤까지 막아 주지 않는다. PC에서는 시계 옆에 스크롤바가
  // 남고 휠로 뒤가 굴러간다. 열려 있는 동안만 잠근다.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  // 화면 켜 두기. 지원하지 않는 브라우저에서는 조용히 넘어간다.
  const hold = open && !paused;
  useEffect(() => {
    if (!hold || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || sentinel) return;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void next.release();
          return;
        }
        sentinel = next;
        // 다른 앱에 다녀오면 브라우저가 잠금을 거둬 간다. 돌아왔을 때 다시 잡는다.
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        /* 배터리 절약 모드 등에서 거절될 수 있다. 시계는 그대로 보인다. */
      }
    };
    void acquire();
    const onVisible = () => void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [hold]);

  // 한 시간이 넘으면 자릿수가 늘어난다. 좁은 화면에서 넘치지 않게 한 단계 줄인다.
  const long = elapsed.length > 5;

  return (
    // 닫힌 dialog는 display:none이어야 한다. 배치는 안쪽 div가 맡는다.
    <dialog
      ref={dialog}
      aria-label="독서 타이머 집중 화면"
      onClose={onClose}
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-background p-0 text-foreground backdrop:bg-background"
    >
      {/* 가로로 눕힌 휴대폰은 높이가 400px 안팎이다. 간격과 숫자를 줄여 단추까지 한 화면에 담는다. */}
      <div className="flex h-full flex-col items-center justify-between gap-6 px-6 pt-4 pb-[max(2rem,env(safe-area-inset-bottom))] [@media(max-height:500px)]:gap-2 [@media(max-height:500px)]:pt-2 [@media(max-height:500px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex w-full items-center justify-between gap-3">
          <p className="min-w-0 text-sm leading-5 text-muted-foreground">
            닫아도 타이머는 계속 가요.
          </p>
          <div className="flex shrink-0 gap-2">
            {onQuote && (
              <Button type="button" variant="outline" onClick={onQuote}>
                <TextQuote aria-hidden="true" />
                문장 남기기
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => dialog.current?.close()}>
              <Minimize2 aria-hidden="true" />
              닫기
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 max-w-full flex-col items-center text-center">
          {/* 책 옆에 놓인 폰을 흘끗 봐도 읽히게, 시계 다음으로 크게 쓴다. */}
          <p
            className={cn(
              'text-lg font-semibold sm:text-xl [@media(max-height:500px)]:text-sm',
              paused ? 'text-muted-foreground' : 'text-primary',
            )}
          >
            {paused ? '잠시 멈춤' : studying ? '학습 중' : '읽는 중'}
          </p>
          {title && (
            <p className="mt-2 line-clamp-2 max-w-2xl break-words text-2xl font-bold leading-tight sm:text-4xl [@media(max-height:500px)]:mt-0.5 [@media(max-height:500px)]:line-clamp-1 [@media(max-height:500px)]:text-lg">
              {title}
            </p>
          )}
          {/* 열려 있을 때만 붙인다. 붙을 때 서재를 한 번 불러온다. */}
          {open && resourceId && <ReadingPositionLines resourceId={resourceId} />}
          <p
            role="timer"
            aria-label={`읽은 시간 ${elapsed}${paused ? ', 잠시 멈춤' : ''}`}
            className={cn(
              'mt-4 font-semibold leading-none tabular-nums [@media(max-height:500px)]:mt-1',
              long
                ? 'text-[length:clamp(3rem,min(17vw,38vh),9rem)]'
                : 'text-[length:clamp(3.5rem,min(25vw,38vh),11rem)]',
              '[@media(max-height:500px)]:text-[length:min(17vw,30vh)]',
              paused ? 'text-muted-foreground' : 'text-primary',
            )}
          >
            {elapsed}
          </p>
        </div>

        <div className="flex w-full max-w-md gap-3">
          {paused ? (
            <Button
              type="button"
              variant="outline"
              className="h-14 flex-1 text-base [@media(max-height:500px)]:h-12"
              onClick={onResume}
            >
              <Play aria-hidden="true" />
              이어 읽기
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-14 flex-1 text-base [@media(max-height:500px)]:h-12"
              onClick={onPause}
            >
              <Pause aria-hidden="true" />
              잠시 멈춤
            </Button>
          )}
          <Button
            type="button"
            className="h-14 flex-1 text-base [@media(max-height:500px)]:h-12"
            onClick={() => {
              // 기록 창도 모달이다. 이 화면을 먼저 닫고 넘긴다.
              dialog.current?.close();
              onStop();
            }}
          >
            <Square aria-hidden="true" />
            {studying ? '다 했어요' : '다 읽었어요'}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

/** 지난번에 어디까지 읽었고 지금 어디부터인지, 오늘 일정이 남았으면 어디까지인지. */
function ReadingPositionLines({ resourceId }: { resourceId: string }) {
  const { data } = useWorkspace();
  const position = data ? readingPosition(data, resourceId) : null;
  if (!position) return null;
  const { from, today } = describePosition(position);
  return (
    <div className="mt-3 space-y-1 text-lg sm:text-2xl [@media(max-height:500px)]:mt-1 [@media(max-height:500px)]:text-sm">
      <p className="tabular-nums">{from}</p>
      {today && (
        <p className="text-base text-muted-foreground tabular-nums sm:text-xl [@media(max-height:500px)]:hidden">
          {today}
        </p>
      )}
    </div>
  );
}
