'use client';

import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { BookMarked, Plus, X } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { MAX_PHRASE_LENGTH, catchMessage, normalizePhrase } from '@/lib/word-catch';

/**
 * 공부하는 중에 모르는 단어를 그 자리에서 단어장에 담는다.
 *
 * 평소에는 줄 하나로 접어 둔다. 듣거나 쓰던 것을 멈추게 하지 않는 것이
 * 이 기능의 전부이기 때문이다. 뜻은 묻지 않는다. 단어장에서 AI가 채운다.
 *
 * 영상이 있는 방에서는 플레이어 바로 밑에, 없는 방에서는 탭 밑에 그린다.
 * 두 자리를 오가며 다시 그려지므로 열림 상태와 담은 개수는 학습 화면이 들고 있다.
 */
export function WordCatcher({
  workspaceId,
  onActivity,
  open,
  onOpenChange,
  saved,
  onSaved,
}: {
  workspaceId: string;
  onActivity?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  saved: number;
  onSaved: () => void;
}) {
  const { apiFetch } = useAuth();
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const word = normalizePhrase(phrase);
    if (!word || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await apiFetch('/api/learning/expressions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phrase: word, workspaceId }),
      });
      if (response.ok) {
        setPhrase('');
        onSaved();
        setFailed(false);
        setMessage(catchMessage('SAVED', word));
      } else if (response.status === 409) {
        setPhrase('');
        setFailed(false);
        setMessage(catchMessage('DUPLICATE', word));
      } else {
        setFailed(true);
        setMessage(catchMessage('FAILED', word));
      }
    } catch {
      setFailed(true);
      setMessage(catchMessage('FAILED', word));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onOpenChange(true);
            setMessage('');
            window.setTimeout(() => field.current?.focus(), 0);
          }}
        >
          <BookMarked size={15} aria-hidden="true" />
          단어 담기
        </Button>
        {saved > 0 && (
          <p className="text-sm text-muted-foreground">
            이번 학습에서 {saved}개 담았어요.{' '}
            <Link href="/learn/words" className="text-primary underline">
              단어장
            </Link>
          </p>
        )}
      </div>
    );

  return (
    <form
      onSubmit={save}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 space-y-2 text-sm" htmlFor="catch-phrase">
          <span className="font-medium">단어 담기</span>
          <Input
            id="catch-phrase"
            ref={field}
            maxLength={MAX_PHRASE_LENGTH}
            placeholder="모르는 단어"
            autoComplete="off"
            value={phrase}
            onChange={(event) => {
              setPhrase(event.target.value);
              onActivity?.();
            }}
          />
        </label>
        <Button type="submit" disabled={busy || !normalizePhrase(phrase)}>
          <Plus size={15} aria-hidden="true" />
          {busy ? '담는 중…' : '담기'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-label="단어 담기 닫기"
          disabled={busy}
          onClick={() => onOpenChange(false)}
        >
          <X size={15} aria-hidden="true" />
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        뜻은 적지 않아도 돼요. 단어장에서 AI가 뜻과 예문을 채우고, 다음 날부터
        복습에 나와요.
      </p>
      {message && (
        <p
          role={failed ? 'alert' : 'status'}
          className={failed ? 'text-sm text-danger' : 'text-sm text-primary'}
        >
          {message}
        </p>
      )}
      {saved > 0 && (
        <p className="text-sm text-muted-foreground">
          이번 학습에서 {saved}개 담았어요.{' '}
          <Link href="/learn/words" className="text-primary underline">
            단어장에서 보기
          </Link>
        </p>
      )}
    </form>
  );
}
