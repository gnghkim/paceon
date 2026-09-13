'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth-provider';
import type { WorkspaceData } from '@/lib/workspace-types';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

export function useWorkspace(query = '') {
  const { apiFetch, session } = useAuth();
  const [revision, setRevision] = useState(0);
  const key = `${session?.user.id ?? ''}:${query}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    data: WorkspaceData | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    void apiFetch(`/api/workspace${query}`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error ?? '자료를 불러오지 못했습니다.');
        if (!controller.signal.aborted)
          setResult({ key, data: body as WorkspaceData, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setResult({
            key,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : '연결을 확인하고 다시 시도해 주세요.',
          });
      });
    return () => controller.abort();
  }, [apiFetch, session, key, query]);
  const current = result?.key === key ? result : null;
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return {
    data: current?.data ?? null,
    loading: !current,
    error: current?.error ?? null,
    reload,
  };
}
export function WorkspaceLoading() {
  return (
    <div role="status" aria-label="자료 불러오는 중" className="space-y-5">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-44 w-full" />
      <span className="sr-only">자료를 불러오고 있습니다.</span>
    </div>
  );
}
export function WorkspaceError({
  error,
  reload,
}: {
  error: string;
  reload: () => void;
}) {
  return (
    <div role="alert" className="rounded-xl border border-border bg-card p-8">
      <h2 className="font-semibold">잠시 멈췄어요</h2>
      <p className="mt-2 mb-5 text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" onClick={reload}>
        다시 불러오기
      </Button>
    </div>
  );
}
