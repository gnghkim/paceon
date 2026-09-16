import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { ServiceWorker } from '@/components/service-worker';

export const metadata: Metadata = {
  title: 'PaceOn — 내 속도에 맞춘 학습',
  description: '내 속도에 맞춰 계속 다시 짜주는 학습 계획',
  applicationName: 'PaceOn',
  appleWebApp: { capable: true, title: 'PaceOn', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  // 설치한 화면의 주소창·상태바 색. 기기 설정을 따르는 어두운 화면에 맞춰 둘 다 준다.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#5965e8' },
    { media: '(prefers-color-scheme: dark)', color: '#16171a' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <AuthProvider>{children}</AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
