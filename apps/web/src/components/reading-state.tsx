'use client';

import { useState } from 'react';
import type { Resource } from '@paceon/shared';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { WORKSPACE_CHANGED } from '@/lib/quick-record';
import { readingState, type ReadingChange } from '@/lib/reading-state';

const actions: Partial<Record<ReturnType<typeof readingState>, { change: ReadingChange; label: string }>> = {
  NOT_STARTED: { change: 'START', label: '독서 시작' },
  FINISHED: { change: 'REREAD', label: '재독 시작' },
  REREADING: { change: 'STOP_REREAD', label: '재독 마치기' },
};

/**
 * 독서 시작, 재독 시작, 재독 마치기. 누르면 독서 기록 창의 목록이 바뀐다.
 * 재독 마치기는 도서 상세에서만 보인다(stop). 서재 목록에서는 시작하는 단추만 둔다.
 */
export function ReadingStateButton({
  book,
  stop = false,
  size,
  className,
}: {
  book: Pick<Resource, 'id' | 'title' | 'status' | 'reading_started_at' | 'rereading_since'>;
  stop?: boolean;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const { apiFetch } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const action = actions[readingState(book)];
  if (!action || (action.change === 'STOP_REREAD' && !stop)) return null;

  async function change() {
    if (!action || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/resources/books/${book.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reading: action.change }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? '바꾸지 못했어요. 다시 시도해 주세요.');
      }
      window.dispatchEvent(new Event(WORKSPACE_CHANGED));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <Button
        type="button"
        size={size}
        variant={action.change === 'STOP_REREAD' ? 'outline' : 'default'}
        disabled={busy}
        aria-label={`${book.title} ${action.label}`}
        onClick={() => void change()}
      >
        {busy ? '바꾸는 중…' : action.label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
