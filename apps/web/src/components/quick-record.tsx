'use client';

import Link from 'next/link';
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { PencilLine, X } from 'lucide-react';
import {
  initialRecordBook,
  recordableBooks,
  WORKSPACE_CHANGED,
} from '@/lib/quick-record';
import {
  useWorkspace,
  WorkspaceError,
  WorkspaceLoading,
} from './workspace-data';
import { ProgressForm, rereadMessage, type ProgressSummary } from './progress-form';
import { StartReadingButton, useReadingTimer } from './reading-timer';
import { Button } from './ui/button';
import { SHEET_DIALOG_CLASS, useSheetDialog } from './sheet-dialog';

/** 두 번째 인자는 타이머가 잰 분이다. 없으면 사용자가 직접 넣는다. */
const RecordContext = createContext<(bookId?: string, minutes?: number) => void>(
  () => {},
);
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
      {children ?? '독서 기록'}
    </Button>
  );
}

export function QuickRecordProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<{
    bookId: string | undefined;
    minutes: number | undefined;
  } | null>(null);
  const [notice, setNotice] = useState<ProgressSummary | null>(null);
  return (
    <RecordContext
      value={(bookId, minutes) => {
        setNotice(null);
        setRequest({ bookId, minutes });
      }}
    >
      {children}
      {notice && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-start gap-3 rounded-xl border border-primary/30 bg-surface p-4 shadow-lg md:bottom-6"
        >
          <div className="flex-1 text-sm">
            <p className="font-semibold">
              {notice.reread
                ? notice.title
                : `기록을 저장했어요 · 현재 ${notice.completedThroughPage}쪽`}
            </p>
            <p className="mt-1 text-muted-foreground">
              {notice.reread
                ? rereadMessage(notice.reread)
                : notice.unplanned
                  ? '진도를 반영했어요. 계획을 세우면 이어서 일정을 잡아 드려요.'
                  : notice.replanStatus === 'pending'
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
          minutes={request.minutes}
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
  minutes,
  onClose,
  onSaved,
}: {
  bookId: string | undefined;
  minutes: number | undefined;
  onClose: () => void;
  onSaved: (result: ProgressSummary) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [locked, setLocked] = useState(false);
  useSheetDialog(dialog);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="quick-record-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onClose();
      }}
      className={SHEET_DIALOG_CLASS}
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <h2 id="quick-record-title" className="text-xl font-semibold">
          독서 기록
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
        minutes={minutes}
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
  minutes,
  onClose,
  onSaved,
  locked,
  onLockedChange,
}: {
  bookId: string | undefined;
  minutes: number | undefined;
  onClose: () => void;
  onSaved: (result: ProgressSummary) => void;
  locked: boolean;
  onLockedChange: (locked: boolean) => void;
}) {
  const { data, error, reload } = useWorkspace();
  const { running } = useReadingTimer();
  const [selected, setSelected] = useState(() =>
    initialRecordBook(bookId, running),
  );
  // 저장하고 나면 이 창은 결과와 떠올리기를 보여 준다. 그때 읽기 시작은 어울리지 않는다.
  const [recorded, setRecorded] = useState(false);
  if (error) return <WorkspaceError error={error} reload={reload} />;
  if (!data) return <WorkspaceLoading />;
  const choices = recordableBooks(data);
  // An explicit but unavailable selection must never silently record another book.
  const selectedId =
    selected || (choices.length === 1 ? choices[0]!.book.id : '');
  const choice = choices.find((item) => item.book.id === selectedId);
  // 타이머를 켠 책이 그사이 일시 정지되거나 보관되면 목록에 없다. 잰 시간은 알려 두어
  // 다른 책을 고르든 나중에 적든 잃지 않게 한다.
  const unavailable =
    bookId !== undefined && !choices.some((item) => item.book.id === bookId);
  return (
    <div className="space-y-4">
      {unavailable && (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          타이머를 켠 책은 지금 기록할 수 없어요. 계획이 일시 정지됐거나 보관한
          책이에요.
          {minutes !== undefined && ` 잰 시간은 ${minutes}분이에요.`}
        </p>
      )}
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
                {book.status === 'COMPLETED' ? ' · 재독 중' : ''}
                {choices.find((item) => item.book.id === book.id)?.plan
                  ? ''
                  : ' · 계획 없음'}
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
            지금 기록할 수 있는 책이 없어요. 서재에서 읽을 책의 독서 시작을, 다시 읽을
            책의 재독 시작을 눌러 주세요. 일시 정지한 계획은 먼저 재개해 주세요.
          </p>
          <p className="text-sm text-muted-foreground">
            영어 학습 시간은{' '}
            <Link href="/learn" className="underline" onClick={onClose}>
              영어 학습
            </Link>
            에서 자동으로 기록돼요.
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
      {running && (
        <p className="rounded-lg bg-primary-soft p-3 text-sm text-primary">
          {running.title ? `‘${running.title}’ ` : ''}
          {running.unit ? '학습' : '읽는'} 시간을 재고 있어요. 끝내면 위쪽 띠의 ‘
          {running.unit ? '다 했어요' : '다 읽었어요'}’를 눌러 주세요. 잰 시간이
          채워진 채로 기록 창이 열려요.
        </p>
      )}
      {/* 타이머를 끝내고 열린 창이면 방금 다 읽은 것이다. 다시 시작하라고 권하지 않는다. */}
      {choice && minutes === undefined && !running && !recorded && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <p className="text-sm text-muted-foreground">
            지금부터 읽나요? 시간을 재고, 끝내면 이 창에 채워 드려요.
          </p>
          <StartReadingButton
            resourceId={choice.book.id}
            title={choice.book.title}
            disabled={locked}
            className="shrink-0"
            onStart={onClose}
          />
        </div>
      )}
      {choice && (
        <ProgressForm
          key={`${choice.book.id}:${choice.book.progress_version}:${choice.plan?.version ?? 0}`}
          compact
          {...(minutes === undefined ? {} : { initialDuration: minutes })}
          book={choice.book}
          plan={choice.plan}
          data={data}
          onLockedChange={onLockedChange}
          onRecorded={() => setRecorded(true)}
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
