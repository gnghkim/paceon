// 설치형 앱으로 인정받기 위한 최소 서비스 워커.
// 캐시를 두지 않는다. fetch는 그대로 네트워크로 흘려보내므로 오래된 화면이 남지 않고,
// 기록·초안 보관은 기존 서버와 기기 저장소가 그대로 맡는다.
// 알림 수신은 후속 작업이며 여기에 아직 push 처리기가 없다.
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
