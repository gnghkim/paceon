'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { useAuth } from './auth-provider';
import { RecallPrompt } from './recall-prompt';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { WORKSPACE_CHANGED } from '@/lib/quick-record';
import type { MaterialDetail } from '@/lib/unit-materials-api';

export interface UnitRecordRequest {
  materialId: string;
  /** 미리 고른 챕터. 없으면 오늘 잡힌 것 중 첫 번째, 그것도 없으면 남은 첫 챕터다. */
  unitId?: string;
  /** 타이머가 잰 분. 채워 두되 고칠 수 있다. */
  minutes?: number;
  /** REPEAT이면 이미 한 챕터를 다시 공부한 기록이다. */
  mode?: 'COMPLETE' | 'REPEAT';
}

const UnitRecordContext = createContext<(request: UnitRecordRequest) => void>(() => {});
export const useUnitRecord = () => useContext(UnitRecordContext);

/** 자료 화면이 기록 저장을 알아채고 다시 읽을 수 있게 하는 이벤트. */
export const MATERIAL_CHANGED = 'paceon:material-changed';

/**
 * 챕터 하나를 공부한 기록. 책의 기록 창과 나란히 있다.
 * 책은 "어디까지 읽었나"를 묻고 여기는 "어느 챕터를 했나"를 묻는다. 순서와 상관없이
 * 아무 챕터나 고를 수 있고, 고른 챕터는 남은 일정에서 빠진다.
 */
export function UnitRecordProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<UnitRecordRequest | null>(null);
  const [notice, setNotice] = useState('');
  return (
    <UnitRecordContext
      value={(next) => {
        setNotice('');
        setRequest(next);
      }}
    >
      {children}
      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-primary/30 bg-surface p-4 shadow-lg md:bottom-6"
        >
          <p className="flex-1 text-sm font-semibold">{notice}</p>
          <button
            type="button"
            aria-label="저장 안내 닫기"
            className="flex size-11 shrink-0 items-center justify-center"
            onClick={() => setNotice('')}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {request && (
        <UnitRecordDialog
          key={`${request.materialId}:${request.unitId ?? ''}:${request.mode ?? ''}`}
          request={request}
          onClose={() => setRequest(null)}
          onDone={(message) => {
            setRequest(null);
            setNotice(message);
            window.dispatchEvent(new Event(WORKSPACE_CHANGED));
            window.dispatchEvent(new Event(MATERIAL_CHANGED));
          }}
        />
      )}
    </UnitRecordContext>
  );
}

function UnitRecordDialog({
  request,
  onClose,
  onDone,
}: {
  request: UnitRecordRequest;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { apiFetch } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [loadError, setLoadError] = useState('');
  const [unitId, setUnitId] = useState(request.unitId ?? '');
  const [minutes, setMinutes] = useState(request.minutes === undefined ? '' : String(request.minutes));
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ unit: { id: string; title: string }; line: string } | null>(null);
  // 같은 요청을 다시 보내도 두 번 기록되지 않게, 내용이 같으면 같은 키를 쓴다.
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  // 저장한 뒤 떠올리는 도중에 닫아도 화면은 새 진도를 보여야 한다.
  const pendingDone = useRef<string | null>(null);

  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void apiFetch(`/api/resources/materials/${request.materialId}`, { cache: 'no-store', signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body.error ?? '자료를 불러오지 못했어요.');
          if (!controller.signal.aborted) setDetail(body as MaterialDetail);
        })
        .catch((cause: Error) => {
          if (!controller.signal.aborted) setLoadError(cause.message);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiFetch, request.materialId]);

  const close = useCallback(() => {
    if (busy) return;
    const message = pendingDone.current;
    pendingDone.current = null;
    if (message) onDone(message);
    else onClose();
  }, [busy, onClose, onDone]);

  const repeat = request.mode === 'REPEAT';
  const label = detail?.material.unit_label ?? '챕터';
  const choices = (detail?.units ?? []).filter((unit) => !unit.section && unit.done === repeat);
  // 고르지 않았으면 오늘 잡힌 것부터. 그것도 없으면 남은 첫 챕터.
  const fallback =
    choices.find((unit) => unit.scheduledOn === detail?.today)?.id ?? choices[0]?.id ?? '';
  const selectedId = choices.some((unit) => unit.id === unitId) ? unitId : fallback;
  const selected = choices.find((unit) => unit.id === selectedId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    const payload = {
      kind: repeat ? 'REPEAT' : 'COMPLETE',
      unitId: selected.id,
      ...(minutes === '' ? {} : { durationMinutes: Number(minutes) }),
      ...(memo.trim() ? { memo: memo.trim() } : {}),
    };
    const signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/resources/materials/${request.materialId}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, idempotencyKey: attempt.current.key }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (response.status < 500) attempt.current = null;
        setError(body.error ?? '기록을 저장하지 못했어요.');
        return;
      }
      const line = repeat
        ? `${selected.title} 다시 공부한 것을 남겼어요`
        : `${selected.title} 완료 · ${body.done}/${body.total}${label}`;
      pendingDone.current = line;
      setSaved({ unit: { id: selected.id, title: selected.title }, line });
    } catch {
      setError('저장 결과를 확인하지 못했어요. 다시 누르면 같은 요청으로 확인해요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="unit-record-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      className="fixed inset-x-0 top-auto m-0 mx-auto w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:rounded-2xl"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 id="unit-record-title" className="min-w-0 truncate text-xl font-semibold">
          {repeat ? '다시 공부한 기록' : '학습 기록'}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="기록창 닫기" disabled={busy} onClick={close}>
          <X size={20} />
        </Button>
      </header>

      {loadError ? (
        <p role="alert" className="py-6 text-sm text-danger">
          {loadError}
        </p>
      ) : !detail ? (
        <Skeleton className="h-48 w-full" />
      ) : saved ? (
        <RecallPrompt
          resourceId={request.materialId}
          range={null}
          unit={saved.unit}
          savedLine={saved.line}
          onDone={() => {
            const message = pendingDone.current ?? saved.line;
            pendingDone.current = null;
            onDone(message);
          }}
        />
      ) : choices.length === 0 ? (
        <p className="py-6 text-sm leading-6 text-muted-foreground">
          {repeat ? `아직 공부한 ${label}이(가) 없어요.` : `남은 ${label}이(가) 없어요. 모두 공부했어요.`}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <p className="truncate text-sm text-muted-foreground">{detail.material.title}</p>
          <label className="block space-y-2 text-sm" htmlFor="unit-choice">
            <span className="font-medium">{repeat ? `다시 공부한 ${label}` : `공부한 ${label}`}</span>
            <select
              id="unit-choice"
              value={selectedId}
              disabled={busy}
              onChange={(event) => setUnitId(event.target.value)}
              className="h-12 w-full rounded-lg border border-border bg-surface px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
            >
              {choices.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.title}
                  {unit.scheduledOn === detail.today ? ' · 오늘' : ''}
                </option>
              ))}
            </select>
            {!repeat && (
              <span className="block text-xs leading-5 text-muted-foreground">
                순서와 상관없이 아무 {label}이나 고를 수 있어요. 고른 것은 남은 일정에서 빠져요.
              </span>
            )}
          </label>
          <label className="block space-y-2 text-sm" htmlFor="unit-memo">
            <span className="font-medium">무엇을 공부했나요? (선택)</span>
            <textarea
              id="unit-memo"
              value={memo}
              maxLength={10000}
              rows={3}
              disabled={busy}
              onChange={(event) => setMemo(event.target.value)}
              placeholder="공부한 내용, 헷갈린 것, 다시 볼 것"
              className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm leading-6"
            />
          </label>
          <label className="block space-y-2 text-sm" htmlFor="unit-minutes">
            <span className="font-medium">공부한 시간 (분, 선택)</span>
            <Input
              id="unit-minutes"
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={minutes}
              disabled={busy}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy || !selected}>
            {busy ? '저장 중…' : repeat ? '기록 저장하기' : '공부했어요'}
          </Button>
        </form>
      )}
    </dialog>
  );
}
