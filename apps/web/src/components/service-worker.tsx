'use client';

import { useEffect } from 'react';

/**
 * 설치형 앱으로 열 수 있게 최소 서비스 워커를 등록한다.
 * 캐시가 없으므로 실패해도 앱 동작에는 영향이 없다. 조용히 넘어간다.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const timer = setTimeout(() => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* 설치 안내만 못 받을 뿐 학습에는 지장이 없다. */
      });
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
