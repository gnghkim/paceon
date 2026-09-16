// 설치형 앱으로 인정받기 위한 최소 서비스 워커.
// 캐시를 두지 않는다. fetch는 그대로 네트워크로 흘려보내므로 오래된 화면이 남지 않고,
// 기록·초안 보관은 기존 서버와 기기 저장소가 그대로 맡는다.
// 알림은 서버가 보낸 내용을 그대로 보여 준다. 여기서 학습 기록을 읽거나 저장하지 않는다.
const VERSION = '1';

self.addEventListener('install', () => {
  // 새 워커가 기다리지 않고 바로 다음 단계로 간다. 캐시가 없어 버릴 것도 없다.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 이전 버전이 캐시를 남겼다면 지운다. 지금은 만들지 않지만 되돌아갈 여지를 없앤다.
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

// 설치 조건을 만족시키기 위한 통과용 처리기다. 응답을 가로채거나 저장하지 않는다.
self.addEventListener('fetch', () => {
  void VERSION;
});

// 서버가 보낸 한 줄을 그대로 띄운다. 내용을 해석하거나 다시 계산하지 않는다.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // 형식이 깨졌으면 기본 문구로 띄운다. 알림을 통째로 버리지 않는다.
  }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : 'PaceOn';
  const body = typeof payload.body === 'string' ? payload.body : '오늘의 학습을 확인해 보세요.';
  const url = typeof payload.url === 'string' && payload.url.startsWith('/') ? payload.url : '/today';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192-maskable.png',
      // 같은 태그를 쓰면 하루에 두 번 도착해도 알림이 쌓이지 않고 덮어쓴다.
      tag: 'paceon-daily',
      data: { url },
    }),
  );
});

// 알림을 누르면 이미 열린 창을 쓰고, 없을 때만 새로 연다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/today';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
