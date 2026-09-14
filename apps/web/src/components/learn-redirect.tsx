'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LAST_AREA_KEY, resolveLearningArea } from './learning-areas';

export function LearnRedirect() {
  const router = useRouter();
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(LAST_AREA_KEY); } catch { /* Default area when storage is blocked. */ }
    router.replace(`/learn/${resolveLearningArea(stored)}`);
  }, [router]);
  return <p role="status" className="text-sm text-muted-foreground">학습실을 여는 중…</p>;
}
