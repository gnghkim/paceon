/**
 * 독서 타이머.
 *
 * 영어학습 타이머와 다르게 벽시계로 잰다. 책은 화면을 보며 읽지 않으므로
 * 화면 꺼짐이나 무활동으로 멈추면 언제나 0분이 된다. 시작한 시각만 저장해 두고
 * 끝낼 때 지난 시간을 계산한다.
 *
 * 저장은 기기에만 한다. 책과 휴대폰은 같은 자리에 있어 기기를 옮겨 가며 읽는 일이
 * 드물고, 최종 시간은 기존 학습 기록의 분으로 들어가 통계가 그대로 받는다.
 *
 * 잠시 멈춤도 벽시계 위에서 센다. 초를 세어 더하지 않고, 멈춘 시각과 지금까지
 * 멈춰 있던 누적만 들고 있다가 전체 흐른 시간에서 뺀다. 그래야 앱을 닫았다
 * 열어도, 멈춘 채 닫아도 같은 값이 나온다.
 */

/** 이 시간을 넘기면 시간을 자동으로 채우지 않고 직접 확인하게 한다. */
export const READING_TIMER_CAP_MINUTES = 240;

/** 이보다 짧으면 0분으로 본다. 잠깐 눌렀다 만 것을 1분으로 올리지 않는다. */
const MINIMUM_SECONDS = 30;

export interface ReadingTimer {
  resourceId: string;
  /** 시작한 시각(epoch 밀리초). */
  startedAt: number;
  /** 멈춘 시각. 재고 있는 중이면 null이다. */
  pausedAt: number | null;
  /** 이미 끝난 멈춤 구간의 합(밀리초). 지금 멈춰 있는 구간은 들어 있지 않다. */
  pausedMs: number;
  /** 띠에 보여 줄 책 제목. 옛 저장값에는 없다. */
  title?: string;
}

export const newReadingTimer = (resourceId: string, now: number, title?: string): ReadingTimer => ({
  resourceId,
  startedAt: now,
  pausedAt: null,
  pausedMs: 0,
  ...(title ? { title } : {}),
});

export const readingTimerKey = (userId: string) => `paceon:reading-timer:${userId}`;

/** 저장된 값을 읽는다. 형태가 어긋나거나 미래에서 시작한 값은 버린다. */
export function parseReadingTimer(raw: string | null, now: number): ReadingTimer | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ReadingTimer>;
    if (typeof value?.resourceId !== 'string' || !value.resourceId) return null;
    if (!Number.isFinite(value.startedAt) || typeof value.startedAt !== 'number') return null;
    // 기기 시계가 바뀌어 미래가 된 값은 쓰지 않는다.
    if (value.startedAt > now) return null;
    // 멈춤이 없던 때의 저장값은 두 칸이 비어 있다. 재는 중으로 읽는다.
    const pausedAt = value.pausedAt ?? null;
    // 없는 칸만 0으로 본다. null은 망가진 값이다(NaN이 저장되면 null이 된다).
    const pausedMs = value.pausedMs === undefined ? 0 : value.pausedMs;
    if (pausedAt !== null && (typeof pausedAt !== 'number' || !Number.isFinite(pausedAt))) return null;
    if (typeof pausedMs !== 'number' || !Number.isFinite(pausedMs) || pausedMs < 0) return null;
    // 시작 전에 멈췄거나, 앞으로 멈출 예정이거나, 흐른 시간보다 오래 멈춘 값은 믿지 않는다.
    if (pausedAt !== null && (pausedAt < value.startedAt || pausedAt > now)) return null;
    if (pausedMs > (pausedAt ?? now) - value.startedAt) return null;
    const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim().slice(0, 200) : undefined;
    return {
      resourceId: value.resourceId,
      startedAt: value.startedAt,
      pausedAt,
      pausedMs,
      ...(title ? { title } : {}),
    };
  } catch {
    return null;
  }
}

/** 읽은 시간. 멈춰 있으면 멈춘 시각에서 더 늘지 않는다. */
export const elapsedSeconds = (timer: ReadingTimer, now: number) =>
  Math.max(0, Math.floor(((timer.pausedAt ?? now) - timer.startedAt - timer.pausedMs) / 1000));

export const isPaused = (timer: ReadingTimer) => timer.pausedAt !== null;

/** 멈춘다. 이미 멈춰 있으면 처음 멈춘 시각을 그대로 둔다. */
export const pauseTimer = (timer: ReadingTimer, now: number): ReadingTimer =>
  timer.pausedAt !== null ? timer : { ...timer, pausedAt: Math.max(now, timer.startedAt) };

/** 이어 읽는다. 멈춰 있던 만큼을 누적에 더한다. 재는 중이면 그대로다. */
export const resumeTimer = (timer: ReadingTimer, now: number): ReadingTimer =>
  timer.pausedAt === null
    ? timer
    : { ...timer, pausedAt: null, pausedMs: timer.pausedMs + Math.max(0, now - timer.pausedAt) };

export interface TimerResult {
  seconds: number;
  /** 기록에 채울 분. 상한을 넘으면 null이며 사용자가 직접 넣는다. */
  minutes: number | null;
  overCap: boolean;
}

/**
 * 끝낼 때의 결과.
 *
 * 상한을 넘으면 분을 돌려주지 않는다. 끄는 것을 잊은 채 하루가 지난 기록이
 * 통계와 기록 속도를 조용히 망가뜨리는 쪽이, 한 번 더 묻는 쪽보다 나쁘다.
 */
export function timerResult(timer: ReadingTimer, now: number): TimerResult {
  const seconds = elapsedSeconds(timer, now);
  const overCap = seconds > READING_TIMER_CAP_MINUTES * 60;
  return {
    seconds,
    minutes: overCap ? null : seconds < MINIMUM_SECONDS ? 0 : Math.round(seconds / 60),
    overCap,
  };
}

/** 헤더 띠에 보여 줄 경과 시간. 한 시간이 넘으면 시간까지 붙인다. */
export function formatElapsed(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = `${Math.floor(whole / 60) % 60}`.padStart(2, '0');
  const rest = `${whole % 60}`.padStart(2, '0');
  return whole >= 3600 ? `${Math.floor(whole / 3600)}:${minutes}:${rest}` : `${minutes}:${rest}`;
}
