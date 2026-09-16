import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeVapidKey, toPayload, pushSupport } from '../apps/web/src/lib/push-client.ts';

const bytes = (...values) => new Uint8Array(values).buffer;

test('a base64url VAPID key decodes to the bytes the browser expects', () => {
  // "hello" in base64url, no padding.
  assert.deepEqual([...decodeVapidKey('aGVsbG8')], [104, 101, 108, 108, 111]);
  // The URL alphabet maps back to the standard one.
  assert.deepEqual([...decodeVapidKey('-_8')], [251, 255]);
  // Surrounding whitespace from a copied environment variable is tolerated.
  assert.deepEqual([...decodeVapidKey('  aGVsbG8  ')], [104, 101, 108, 108, 111]);
});

test('a key that is not base64 is refused rather than sent as garbage', () => {
  for (const bad of ['not base64!', '###', 'aGVsbG8$'])
    assert.throws(() => decodeVapidKey(bad), /알림 키/);
});

test('a subscription becomes base64url keys with no padding', () => {
  const payload = toPayload({
    endpoint: 'https://push.example/abc',
    getKey: (name) => (name === 'p256dh' ? bytes(251, 255, 104) : bytes(1, 2, 3)),
  });
  assert.equal(payload.endpoint, 'https://push.example/abc');
  assert.equal(payload.keys.p256dh, '-_9o');
  assert.equal(payload.keys.auth, 'AQID');
  assert.equal(payload.timezone, undefined);
});

test('the timezone rides along only when the caller knows it', () => {
  const subscription = { endpoint: 'https://push.example/abc', getKey: () => bytes(1, 2, 3) };
  assert.equal(toPayload(subscription, 'Asia/Seoul').timezone, 'Asia/Seoul');
  assert.equal(toPayload(subscription, '').timezone, undefined);
});

test('a subscription missing its keys is refused instead of stored half-formed', () => {
  assert.throws(
    () => toPayload({ endpoint: 'https://push.example/abc', getKey: () => null }),
    /알림 키/,
  );
  assert.throws(
    () => toPayload({ endpoint: 'https://push.example/abc', getKey: () => new ArrayBuffer(0) }),
    /알림 키/,
  );
});

const runtime = { serviceWorker: true, pushManager: true, notification: true, secure: true };
test('support says yes only when the browser, the page and the server are all ready', () => {
  assert.deepEqual(pushSupport(runtime, 'key'), { supported: true });
  assert.deepEqual(pushSupport({ ...runtime, secure: false }, 'key'), { supported: false, reason: 'insecure' });
  assert.deepEqual(pushSupport({ ...runtime, pushManager: false }, 'key'), { supported: false, reason: 'browser' });
  assert.deepEqual(pushSupport({ ...runtime, notification: false }, 'key'), { supported: false, reason: 'browser' });
  assert.deepEqual(pushSupport({ ...runtime, serviceWorker: false }, 'key'), { supported: false, reason: 'browser' });
  assert.deepEqual(pushSupport(runtime, undefined), { supported: false, reason: 'unconfigured' });
  assert.deepEqual(pushSupport(runtime, ''), { supported: false, reason: 'unconfigured' });
});

test('an insecure page is reported as such even on a capable browser', () => {
  assert.deepEqual(pushSupport({ serviceWorker: false, pushManager: false, notification: false, secure: false }, 'key'), {
    supported: false,
    reason: 'insecure',
  });
});
