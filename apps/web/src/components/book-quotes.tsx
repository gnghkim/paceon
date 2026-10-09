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
import { Pencil, TextQuote, Trash2, X } from 'lucide-react';
import { useAuth } from './auth-provider';
import { useWorkspace } from './workspace-data';
import { SHEET_DIALOG_CLASS, useSheetDialog } from './sheet-dialog';
import { Button } from './ui/button';
import { Card } from './ui/card';
import {
  MAX_QUOTE_LENGTH,
  normalizeQuoteText,
  suggestQuotePage,
  validQuotePage,
  type BookQuote,
} from '@/lib/book-quotes';
import { describePosition, readingPosition } from '@/lib/reading-timer';

/** 문장을 남기거나 고치거나 지우면 알린다. detail은 책 id다. */
const QUOTES_CHANGED = 'paceon:quotes-changed';

interface Target {
  bookId: string;
  /** 있으면 이 문장을 고친다. */
  quote?: BookQuote;
}

const QuoteContext = createContext<(target: Target) => void>(() => {});
/** 문장 입력창을 연다. 읽는 도중(타이머 띠와 집중 화면)과 도서 상세에서 쓴다. */
export const useQuoteWriter = () => useContext(QuoteContext);

export function QuoteProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<Target | null>(null);
  // 책마다 이번에 마지막으로 남긴 쪽. 같은 자리에서 몇 문장을 이어 남기는 일이 흔하다.
  const [lastUsed, setLastUsed] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  return (
    <QuoteContext
      value={(next) => {
        setNotice(null);
        setTarget(next);
      }}
    >
      {children}
      {target && (
        <QuoteDialog
          key={`${target.bookId}:${target.quote?.id ?? 'new'}`}
          target={target}
          lastUsed={lastUsed[target.bookId]}
          onClose={() => setTarget(null)}
          onSaved={(quote) => {
            setLastUsed((current) => ({ ...current, [target.bookId]: quote.page }));
            setNotice(target.quote ? `${quote.page}쪽 문장을 고쳤어요.` : `${quote.page}쪽 문장을 남겼어요.`);
            setTarget(null);
            window.dispatchEvent(new CustomEvent(QUOTES_CHANGED, { detail: target.bookId }));
          }}
        />
      )}
      {notice && <QuoteNotice message={notice} onDone={clearNotice} />}
    </QuoteContext>
  );
}

/**
 * 저장했다는 알림. 집중 화면은 맨 위 층(top layer)에 떠 있어 보통의 고정 요소는 그 뒤에
 * 가린다. 알림도 맨 위 층에 올려 집중 화면에서 남겼을 때도 보이게 한다.
 */
function QuoteNotice({ message, onDone }: { message: string; onDone: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    try {
      node?.showPopover();
    } catch {
      /* 팝오버를 모르는 브라우저에서는 보통의 고정 요소로 보인다. */
    }
    const timer = setTimeout(onDone, 4000);
    return () => {
      clearTimeout(timer);
      try {
        node?.hidePopover();
      } catch {
        /* 이미 닫혔다. */
      }
    };
  }, [onDone]);
  return (
    <div
      ref={element}
      popover="manual"
      role="status"
      className="fixed inset-x-4 top-auto bottom-[calc(6rem+env(safe-area-inset-bottom))] m-0 mx-auto max-w-md rounded-xl border border-primary/30 bg-surface p-4 text-sm font-semibold text-foreground shadow-lg md:bottom-6"
    >
      {message}
    </div>
  );
}

function QuoteDialog({
  target,
  lastUsed,
  onClose,
  onSaved,
}: {
  target: Target;
  lastUsed: number | undefined;
  onClose: () => void;
  onSaved: (quote: BookQuote) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useSheetDialog(dialog);
  const { apiFetch } = useAuth();
  const { data } = useWorkspace();
  const editing = target.quote;
  const book = data?.resources.find((item) => item.id === target.bookId);
  const position = data ? readingPosition(data, target.bookId) : null;
  // 손대기 전에는 제안한 쪽을 보여 준다. 서재를 늦게 불러와도 그때 채워진다.
  const [page, setPage] = useState<string | null>(editing ? String(editing.page) : null);
  const suggested = suggestQuotePage(position, lastUsed);
  const pageValue = page ?? (suggested === null ? '' : String(suggested));
  const [content, setContent] = useState(editing?.content ?? '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const totalPages = book?.total_pages ?? null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const pageNumber = Number(pageValue);
    if (!validQuotePage(pageNumber, totalPages)) {
      setError(totalPages ? `쪽은 1에서 ${totalPages} 사이로 적어 주세요.` : '쪽을 적어 주세요.');
      return;
    }
    const text = normalizeQuoteText(content);
    if (!text) {
      setError(content.trim() ? `문장은 ${MAX_QUOTE_LENGTH}자 안으로 적어 주세요.` : '남길 문장을 적어 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(
        `/api/resources/books/${target.bookId}/quotes${editing ? `/${editing.id}` : ''}`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ page: pageNumber, content: text, note: note.trim() ? note : null }),
        },
      );
      const body = (await response.json()) as { quote?: BookQuote; error?: string };
      if (!response.ok || !body.quote) throw new Error(body.error ?? '저장하지 못했어요. 다시 시도해 주세요.');
      onSaved(body.quote);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '저장하지 못했어요. 다시 시도해 주세요.');
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="quote-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={SHEET_DIALOG_CLASS}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="quote-title" className="text-xl font-semibold">
            {editing ? '문장 고치기' : '문장 남기기'}
          </h2>
          {book && <p className="mt-1 truncate text-sm text-muted-foreground">{book.title}</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="문장 입력창 닫기" disabled={busy} onClick={onClose}>
          <X size={20} />
        </Button>
      </header>
      {data && !book ? (
        <p className="py-4 text-sm">이 책을 찾을 수 없어요. 서재에서 지웠는지 확인해 주세요.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <legend className="sr-only">쪽과 문장</legend>
            <label className="block space-y-2 text-sm">
              <span className="font-medium">쪽</span>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  {...(totalPages ? { max: totalPages } : {})}
                  required
                  value={pageValue}
                  onChange={(event) => setPage(event.target.value)}
                  // 미리 채운 쪽은 짐작이다. 누르면 통째로 골라 바로 덮어 쓰게 한다.
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-12 w-28 rounded-lg border border-border bg-surface px-3 text-base tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                {totalPages && <span className="text-muted-foreground">/ {totalPages}쪽</span>}
              </div>
              {position && !editing && (
                <span className="block text-muted-foreground">{describePosition(position).from}</span>
              )}
            </label>
            <label className="block space-y-2 text-sm">
              <span className="font-medium">문장</span>
              <textarea
                required
                rows={5}
                autoFocus={!editing}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="책에 있는 그대로 옮겨 적어요"
                className="w-full rounded-lg border border-border bg-surface p-3 text-base leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
            <label className="block space-y-2 text-sm">
              <span className="font-medium">
                내 생각 <span className="font-normal text-muted-foreground">(적지 않아도 돼요)</span>
              </span>
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="왜 남기고 싶었는지"
                className="w-full rounded-lg border border-border bg-surface p-3 text-base leading-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
            </label>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="min-h-12 w-full text-base">
            {busy ? '저장하는 중…' : editing ? '고친 문장 저장' : '문장 저장'}
          </Button>
        </form>
      )}
    </dialog>
  );
}

/** 같은 쪽의 문장이 여럿이어도 단추의 이름이 겹치지 않게, 문장의 앞부분을 붙인다. */
const snippet = (text: string) => {
  const line = text.replace(/\s+/g, ' ');
  return line.length > 20 ? `${line.slice(0, 20)}…` : line;
};

/** 도서 상세의 남긴 문장. 책의 순서대로 보여 주고, 여기서도 남기고 고치고 지운다. */
export function BookQuotes({ bookId }: { bookId: string }) {
  const { apiFetch } = useAuth();
  const write = useQuoteWriter();
  const [quotes, setQuotes] = useState<BookQuote[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await apiFetch(`/api/resources/books/${bookId}/quotes`, {
          cache: 'no-store',
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) throw new Error();
        const body = (await response.json()) as { quotes: BookQuote[] };
        setQuotes(body.quotes);
        setFailed(false);
      } catch {
        if (!signal?.aborted) setFailed(true);
      }
    },
    [apiFetch, bookId],
  );

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(controller.signal), 0);
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === bookId) void load();
    };
    window.addEventListener(QUOTES_CHANGED, changed);
    return () => {
      clearTimeout(timer);
      controller.abort();
      window.removeEventListener(QUOTES_CHANGED, changed);
    };
  }, [load, bookId]);

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/resources/books/${bookId}/quotes/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error();
      setQuotes((current) => current?.filter((quote) => quote.id !== id) ?? null);
      setConfirming(null);
    } catch {
      setError('지우지 못했어요. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          남긴 문장
          {quotes && quotes.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">{quotes.length}개</span>
          )}
        </h2>
        <Button type="button" variant="outline" onClick={() => write({ bookId })}>
          <TextQuote aria-hidden="true" />
          문장 남기기
        </Button>
      </div>
      {failed && !quotes && (
        <p className="mt-3 text-sm text-muted-foreground">남긴 문장을 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p>
      )}
      {quotes && quotes.length === 0 && (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          읽다가 남기고 싶은 문장을 쪽과 함께 적어 두세요. 읽는 동안에는 위쪽 타이머 띠에서도 남길 수 있어요.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {quotes && quotes.length > 0 && (
        <ul className="mt-4 divide-y divide-border">
          {quotes.map((quote) => (
            <li key={quote.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary tabular-nums">{quote.page}쪽</p>
                  <blockquote className="mt-1.5 whitespace-pre-wrap break-words border-l-2 border-primary/40 pl-3 text-base leading-7">
                    {quote.content}
                  </blockquote>
                  {quote.note && (
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                      <span className="font-medium">내 생각</span> · {quote.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${quote.page}쪽 “${snippet(quote.content)}” 고치기`}
                    onClick={() => write({ bookId, quote })}
                  >
                    <Pencil size={15} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`${quote.page}쪽 “${snippet(quote.content)}” 지우기`}
                    disabled={busy}
                    onClick={() => setConfirming(quote.id)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {confirming === quote.id && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft p-3 text-sm">
                  <span className="mr-auto">이 문장을 지울까요? 되돌릴 수 없어요.</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(null)}>
                    취소
                  </Button>
                  <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void remove(quote.id)}>
                    지우기
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
