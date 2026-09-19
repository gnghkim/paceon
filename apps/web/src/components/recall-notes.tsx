'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { formatDate } from '@/lib/planning';
import { rangeLabel, validRange } from '@/lib/recall';
import type { RecallNote } from '@/lib/recall-api';

/**
 * 이 책을 읽으며 떠올려 적은 것들. 복습에서 다시 묻는 카드의 원본이다.
 * 하나도 없으면 자리를 차지하지 않는다. 적으라고 조르는 빈 상자를 두지 않는다.
 */
export function RecallNotes({
  resourceId,
  refreshKey,
}: {
  resourceId: string;
  /** 기록이 저장되면 바뀌는 값. 그때 목록을 다시 읽는다. */
  refreshKey: number;
}) {
  const { apiFetch } = useAuth();
  const [notes, setNotes] = useState<RecallNote[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiFetch(`/api/learning/recall?resourceId=${resourceId}`, {
          cache: 'no-store',
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) return;
        const body = (await response.json()) as { notes: RecallNote[] };
        setNotes(body.notes);
      } catch {
        /* 보조 목록이다. 못 읽으면 조용히 비워 둔다. */
      }
    },
    [apiFetch, resourceId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [load, refreshKey]);

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      // 회상 카드도 복습 표의 한 줄이다. 지우는 길은 표현과 같다.
      const response = await apiFetch('/api/learning/expressions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error();
      setNotes((current) => current?.filter((note) => note.id !== id) ?? null);
    } catch {
      setError('지우지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (!notes?.length) return null;

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">읽고 떠올린 것</h2>
        <Link href="/review" className="text-sm text-primary underline">
          오늘의 복습
        </Link>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        책을 덮고 적은 것들이에요. 예정일이 되면 복습에서 다시 물어봐요.
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="divide-y divide-border">
        {notes.map((note) => {
          const range = validRange(note.startPage, note.endPage);
          return (
            <li key={note.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  {range && `${rangeLabel(range)} · `}
                  {formatDate(note.createdOn)}에 적음 · 다음 복습 {formatDate(note.dueOn)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{note.content}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                aria-label={`${range ? rangeLabel(range) : ''} 회상 지우기`.trim()}
                onClick={() => void remove(note.id)}
              >
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
