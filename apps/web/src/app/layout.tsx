import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';

export const metadata: Metadata = {
  title: 'PaceOn — 내 속도에 맞춘 학습',
  description: '내 속도에 맞춰 계속 다시 짜주는 학습 계획',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
