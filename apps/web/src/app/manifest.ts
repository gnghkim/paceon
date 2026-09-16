import type { MetadataRoute } from 'next';

/**
 * 홈 화면에 설치해 앱처럼 열기 위한 정보.
 * 오프라인 캐시는 넣지 않는다. 학습 기록과 초안은 서버와 기기 저장소가 이미 맡고 있고,
 * 오래된 화면을 보여 주는 쪽이 습관 앱에서는 더 위험하다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PaceOn — 내 속도에 맞춘 학습',
    short_name: 'PaceOn',
    description: '내 속도에 맞춰 계획하고 기록하는 독서와 영어학습',
    lang: 'ko',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fafaf8',
    theme_color: '#5965e8',
    categories: ['education', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: '오늘의 학습', short_name: '오늘', url: '/today' },
      { name: '영어학습', short_name: '영어', url: '/learn' },
    ],
  };
}
