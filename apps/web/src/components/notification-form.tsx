'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-provider';
import { useWorkspace, WorkspaceError } from './workspace-data';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { decodeVapidKey, pushSupport, toPayload } from '@/lib/push-client';

const VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

const unsupported: Record<string, string> = {
  insecure: '보안 연결에서만 알림을 켤 수 있어요.',
  browser: '이 브라우저는 알림을 지원하지 않아요. iPhone은 홈 화면에 추가한 뒤 열어 주세요.',
  unconfigured: '아직 알림 서버가 준비되지 않았어요.',
};

/**
 * 매일 한 번 오늘 할 분량을 알려 주는 알림.
 * 켜지 않아도 앱의 모든 기능은 그대로 동작한다. 못 채운 날을 따로 알리지 않는다.
 */
export function NotificationForm() {
  const { data, error, reload } = useWorkspace();
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <Skeleton className="h-40 w-full" />;
  return <Fields savedTime={data.notifyAt} onSaved={reload} />;
}

function Fields({
  savedTime,
  onSaved,
}: {
  savedTime: string | null;
  onSaved: () => void;
}) {
  const { apiFetch } = useAuth();
  const [time, setTime] = useState(savedTime ?? '08:00');
  const [devices, setDevices] = useState<number | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failure, setFailure] = useState('');

  const support = pushSupport(
    {
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      pushManager: typeof window !== 'undefined' && 'PushManager' in window,
      notification: typeof window !== 'undefined' && 'Notification' in window,
      secure: typeof window === 'undefined' || window.isSecureContext,
    },
    VAPID_KEY,
  );

  // 브라우저 권한과 등록된 기기 수는 외부 상태다. 렌더 중이 아니라 읽어 온 뒤에 반영한다.
  const refresh = useCallback(async () => {
    if ('Notification' in window) setPermission(Notification.permission);
    try {
      const response = await apiFetch('/api/push', { cache: 'no-store' });
      if (response.ok) setDevices(((await response.json()) as { devices: number }).devices);
    } catch {
      /* 기기 수는 보조 정보다. 못 읽어도 켜고 끄는 데 지장이 없다. */
    }
  }, [apiFetch]);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  async function saveTime(next: string | null) {
    const response = await apiFetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notifyAt: next }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '알림 시각을 저장하지 못했어요.');
    onSaved();
  }

  function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setFailure('');
    void work()
      .catch((cause: unknown) => setFailure((cause as Error).message))
      .finally(() => setBusy(false));
  }

  async function enable() {
    if (!support.supported) throw new Error(unsupported[support.reason]);
    const granted = await Notification.requestPermission();
    setPermission(granted);
    if (granted !== 'granted')
      throw new Error(
        '브라우저에서 알림을 막았어요. 사이트 설정에서 알림을 허용한 뒤 다시 시도해 주세요.',
      );
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(VAPID_KEY!),
      }));
    let timezone = '';
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* 시간대를 못 읽으면 프로필 시간대를 그대로 쓴다. */
    }
    const response = await apiFetch('/api/push', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPayload(subscription, timezone)),
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.error ?? '이 기기를 등록하지 못했어요.');
    }
    await saveTime(time);
    await refresh();
    setMessage(`매일 ${time}에 오늘 할 분량을 알려 드릴게요.`);
  }

  async function disable() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await apiFetch('/api/push', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    await saveTime(null);
    await refresh();
    setMessage('알림을 껐어요. 기록과 계획은 그대로예요.');
  }

  const on = savedTime !== null && (devices ?? 0) > 0;
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      {!support.supported ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {unsupported[support.reason]}
        </p>
      ) : (
        <>
          <label className="block space-y-2 text-sm" htmlFor="notify-at">
            <span className="font-medium">매일 알림 시각</span>
            <Input
              id="notify-at"
              type="time"
              className="max-w-40"
              value={time}
              disabled={busy}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
          <p className="text-xs leading-5 text-muted-foreground">
            그 시각에 오늘 읽을 분량과 영어학습 목표를 한 줄로 보내요. 못 채운 날을 따로
            알리지는 않아요. 기기마다 한 번씩 켜야 하고, iPhone은 홈 화면에 추가한 뒤 열어야
            알림을 받을 수 있어요.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {on ? (
              <>
                <Button type="button" disabled={busy} onClick={() => run(async () => {
                  await saveTime(time);
                  setMessage(`알림 시각을 ${time}으로 바꿨어요.`);
                })}>
                  {busy ? '저장 중…' : '시각 저장'}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => run(disable)}>
                  알림 끄기
                </Button>
              </>
            ) : (
              <Button type="button" disabled={busy} onClick={() => run(enable)}>
                {busy ? '켜는 중…' : '이 기기에서 알림 켜기'}
              </Button>
            )}
            {devices !== null && devices > 0 && (
              <span className="text-sm text-muted-foreground">등록된 기기 {devices}대</span>
            )}
          </div>
          {permission === 'denied' && (
            <p className="text-sm text-muted-foreground">
              브라우저가 이 사이트의 알림을 막고 있어요. 주소창의 사이트 설정에서 허용으로
              바꾼 뒤 다시 켜 주세요.
            </p>
          )}
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-primary">
          {message}
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
    </div>
  );
}
