/**
 * 브라우저 알림 구독을 다루는 순수 도우미.
 * 서버로 보낼 형태로 바꾸는 부분만 여기 두고, 권한 요청과 화면 상태는 컴포넌트가 맡는다.
 */

/** 서버가 준 base64url VAPID 공개키를 브라우저가 요구하는 바이트 배열로 바꾼다. */
export function decodeVapidKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.trim().replace(/-/g, '+').replace(/_/g, '/');
  const base64 = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error('알림 키 형식이 올바르지 않아요.');
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface SubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  timezone?: string;
}

/** PushSubscription을 서버가 저장할 형태로 바꾼다. 키가 없으면 저장하지 않는다. */
export function toPayload(
  subscription: { endpoint: string; getKey(name: 'p256dh' | 'auth'): ArrayBuffer | null },
  timezone?: string,
): SubscriptionPayload {
  const encode = (name: 'p256dh' | 'auth') => {
    const key = subscription.getKey(name);
    if (!key || key.byteLength === 0) throw new Error('브라우저가 알림 키를 주지 않았어요.');
    let binary = '';
    for (const byte of new Uint8Array(key)) binary += String.fromCharCode(byte);
    // 서버와 저장소는 표준 base64url을 쓴다. 패딩은 남기지 않는다.
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: encode('p256dh'), auth: encode('auth') },
    ...(timezone ? { timezone } : {}),
  };
}

export type PushSupport =
  | { supported: true }
  | { supported: false; reason: 'browser' | 'insecure' | 'unconfigured' };

/** 이 브라우저에서 알림을 켤 수 있는지. 못 켜는 이유를 그대로 알려 준다. */
export function pushSupport(
  runtime: { serviceWorker: boolean; pushManager: boolean; notification: boolean; secure: boolean },
  vapidKey: string | undefined,
): PushSupport {
  if (!runtime.secure) return { supported: false, reason: 'insecure' };
  if (!runtime.serviceWorker || !runtime.pushManager || !runtime.notification)
    return { supported: false, reason: 'browser' };
  if (!vapidKey) return { supported: false, reason: 'unconfigured' };
  return { supported: true };
}

/**
 * 이 브라우저가 알림을 받고 있는가.
 *
 * 계정의 기기 수로 판단하면 안 된다. PC에서 켠 뒤 휴대폰에서 열면 이미 켜진 것처럼
 * 보여 그 기기를 등록할 방법이 사라진다. 구독은 브라우저마다 따로 만들어진다.
 */
export const notificationsOn = (
  savedTime: string | null,
  subscribedHere: boolean | null,
) => savedTime !== null && subscribedHere === true;
