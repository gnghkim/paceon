'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { MAX_RECALL_LENGTH, normalizeRecall, rangeLabel, type PageRange } from '@/lib/recall';

/**
 * 기록을 저장한 직후, 책을 덮은 채 기억나는 것을 적게 한다.
 *
 * 읽은 쪽수는 넣은 양이고 여기 적는 것이 남은 양이다. 다시 읽기보다 꺼내기가 오래
 * 남는다. 적은 것은 내일부터 복습에서 다시 묻는다.
 *
 * 언제나 건너뛸 수 있다. 기록은 이미 저장됐고, 이 단계가 기록을 막아서는 안 된다.
 * 떠올리기는 불편한 일이라 강요하면 기록 자체를 피하게 된다.
 */
export function RecallPrompt({
  resourceId,
  range,
  unit,
  savedLine,
  onDone,
}: {
  resourceId: string;
  range: PageRange | null;
  /** 챕터로 공부하는 자료에서는 쪽 범위 대신 방금 공부한 챕터를 넘긴다. */
  unit?: { id: string; title: string };
  /** 방금 저장한 기록을 알리는 한 줄. 이 단계가 저장을 가로막은 것처럼 보이지 않게 한다. */
  savedLine: string;
  onDone: () => void;
}) {
  const { apiFetch } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  // 폼이 사라지며 초점이 갈 곳을 잃는다. 입력칸이 아니라 제목으로 옮긴다.
  // 입력칸으로 옮기면 휴대폰 키보드가 올라와 건너뛰기를 가린다.
  useEffect(() => {
    heading.current?.focus();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const content = normalizeRecall(text);
    if (!content || busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch('/api/learning/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceId, content, ...(unit ? { unitId: unit.id } : (range ?? {})) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? '저장하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      onDone();
    } catch {
      setError('연결을 확인하고 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  const tooLong = text.trim().length > MAX_RECALL_LENGTH;

  return (
    <form onSubmit={save} className="space-y-4">
      <p role="status" className="rounded-lg bg-success-soft px-3 py-2 text-sm font-medium text-success">
        {savedLine}
      </p>
      <div>
        <h3 ref={heading} tabIndex={-1} className="font-semibold focus-visible:outline-none">
          {unit ? '자료를 덮고, 기억나는 것을 적어 보세요' : '책을 덮고, 기억나는 것을 적어 보세요'}
        </h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {unit ? `${unit.title} · ` : range && `${rangeLabel(range)} · `}
          다시 펼쳐 보지 말고 떠오르는 대로 한두 줄이면 돼요. 내일부터 복습에서 다시 물어봐요.
        </p>
      </div>
      <label className="block space-y-2 text-sm" htmlFor="recall-text">
        <span className="sr-only">기억나는 것</span>
        <textarea
          id="recall-text"
          value={text}
          rows={4}
          className="min-h-28 w-full rounded-lg border border-input bg-background p-3 text-sm leading-6"
          placeholder="무엇이 기억에 남았나요?"
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <p className={tooLong ? 'text-xs text-danger' : 'text-xs text-muted-foreground'}>
        {tooLong
          ? `${MAX_RECALL_LENGTH}자 안으로 줄여 주세요. 지금 ${text.trim().length}자예요.`
          : '잘 안 떠올라도 괜찮아요. 막히는 곳이 다음에 다시 볼 곳이에요.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || tooLong || !normalizeRecall(text)}>
          {busy ? '넣는 중…' : '복습에 넣기'}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onDone}>
          건너뛰기
        </Button>
      </div>
    </form>
  );
}
