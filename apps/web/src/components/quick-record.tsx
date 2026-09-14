'use client';

import Link from 'next/link';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PencilLine, X } from 'lucide-react';
import { recordableBooks, WORKSPACE_CHANGED } from '@/lib/quick-record';
import {
  useWorkspace,
  WorkspaceError,
  WorkspaceLoading,
} from './workspace-data';
import { ProgressForm, type ProgressSummary } from './progress-form';
import { Button } from './ui/button';

const RecordContext = createContext<(bookId?: string) => void>(() => {});
export const useQuickRecord = () => useContext(RecordContext);

export function RecordButton({
  bookId,
  children,
  className,
}: {
  bookId?: string;
  children?: ReactNode;
  className?: string;
}) {
  const open = useQuickRecord();
  return (
    <Button type="button" onClick={() => open(bookId)} className={className}>
      <PencilLine size={18} aria-hidden="true" />
      {children ?? '학습 기록'}
    </Button>
  );
}

export function QuickRecordProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{ bookId: string | undefined } | null>(
    null,
  );
  const [notice, setNotice] = useState<ProgressSummary | null>(null);
  return (
    <RecordContext
      value={(bookId) => {
        setNotice(null);
        setRequest({ bookId });
      }}
    >
      {children}
      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-primary/30 bg-surface p-4 shadow-lg md:bottom-6"
        >
          <div className="flex-1 text-sm">
            <p className="font-semibold">
              기록을 저장했어요 · 현재 {notice.completedThroughPage}쪽
            </p>
            <p className="mt-1 text-muted-foreground">
              {notice.replanStatus === 'pending'
                ? '기록은 반영했어요. 도서 상세에서 일정 조정을 확인해 주세요.'
                : '진도와 학습 일정을 반영했어요.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="저장 안내 닫기"
            className="flex size-11 shrink-0 items-center justify-center"
            onClick={() => setNotice(null)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      {request && (
        <RecordDialog
          bookId={request.bookId}
          onClose={() => setRequest(null)}
          onSaved={(result) => {
            setNotice(result);
            setRequest(null);
            window.dispatchEvent(new Event(WORKSPACE_CHANGED));
          }}
        />
      )}
    </RecordContext>
  );
}

function RecordDialog({
  bookId,
  onClose,
  onSaved,
}: {
  bookId: string | undefined;
  onClose: () => void;
  onSaved: (result: ProgressSummary) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const viewport = window.visualViewport;
    const size = () => {
      const height = viewport?.height ?? window.innerHeight;
      element.style.maxHeight = `${Math.max(100, height - 16)}px`;
      element.style.bottom = `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))}px`;
    };
    size();
    viewport?.addEventListener('resize', size);
    viewport?.addEventListener('scroll', size);
    return () => {
      viewport?.removeEventListener('resize', size);
      viewport?.removeEventListener('scroll', size);
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="quick-record-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      className="fixed inset-x-0 top-auto m-0 mx-auto w-full max-w-lg scroll-pb-24 overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:rounded-2xl"
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 id="quick-record-title" className="text-xl font-semibold">
          간편 학습 기록
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="기록창 닫기"
          disabled={locked}
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </header>
      <RecordContent
        bookId={bookId}
        onClose={onClose}
        onSaved={onSaved}
        locked={locked}
        onLockedChange={setLocked}
      />
    </dialog>
  );
}

function RecordContent({
  bookId,
  onClose,
  onSaved,
  locked,
  onLockedChange,
}: {
  bookId: string | undefined;
  onClose: () => void;
  onSaved: (result: ProgressSummary) => void;
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
}) {
  const { data, error, reload } = useWorkspace();
  const [selected, setSelected] = useState(bookId ?? '');
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <WorkspaceLoading />;
  const choices = recordableBooks(data);
  // An explicit but unavailable selection must never silently record another book.
  const selectedId =
    selected || (choices.length === 1 ? choices[0]!.book.id : '');
  const choice = choices.find((item) => item.book.id === selectedId);
  return (
    <div className="space-y-4">
      {choices.length > 0 ? (
        <label className="block space-y-2 text-sm">
          <span className="font-medium">기록할 도서</span>
          <select
            value={choice ? selectedId : ''}
            disabled={locked}
            onChange={(event) => setSelected(event.target.value)}
            className="h-12 w-full rounded-lg border border-border bg-surface px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <option value="" disabled>
              도서를 선택해 주세요
            </option>
            {choices.map(({ book }) => (
              <option key={book.id} value={book.id}>
                {book.title}
                {book.status === 'COMPLETED' ? ' · 복습' : ''}
              </option>
            ))}
          </select>
          {!choice && (
            <p className="text-muted-foreground">
              오늘 학습할 책부터 표시해요. 기록할 책을 선택해 주세요.
            </p>
          )}
        </label>
      ) : (
        <div className="space-y-4 py-5">
          <p>
            지금 기록할 수 있는 책이 없어요. 도서를 추가하고 학습 계획을 만들어
            주세요. 일시 정지한 계획은 먼저 재개해 주세요.
          </p>
          <Button asChild>
            <Link
              href={data.resources.length ? '/resources' : '/resources/new'}
              onClick={onClose}
            >
              내 서재에서 준비하기
            </Link>
          </Button>
        </div>
      )}
      {choice && (
        <ProgressForm
          key={`${choice.book.id}:${choice.book.progress_version}:${choice.plan.version}`}
          compact
          book={choice.book}
          plan={choice.plan}
          data={data}
          onLockedChange={onLockedChange}
          onResult={onSaved}
          onSaved={() => {
            onLockedChange(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
