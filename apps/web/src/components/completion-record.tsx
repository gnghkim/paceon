'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useId, useRef, useState, type ReactNode } from 'react';
import { Flag, X } from 'lucide-react';
import { useWorkspace } from './workspace-data';
import { SHEET_DIALOG_CLASS, useSheetDialog } from './sheet-dialog';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/planning';
import type { WorkspaceData } from '@/lib/workspace-types';
import {
  completionRecord,
  describeTarget,
  formatStudyMinutes,
  type CompletionRecord,
} from '@/lib/completion-record';

/** 서재에서 이 자료와 그 완료 기록. 아직 끝나지 않았으면 기록은 null이다. */
function findCompletion(data: WorkspaceData, resourceId: string) {
  const resource =
    data.resources.find((item) => item.id === resourceId) ?? data.materials.find((item) => item.id === resourceId);
  return resource ? { resource, record: completionRecord(resource, data.events, data.plans) } : null;
}

const amountText = (value: number, label: string) => `${Number.isInteger(value) ? value : value.toFixed(1)}${label}`;

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('mt-1 text-lg font-semibold tabular-nums', tone === 'good' && 'text-success')}>{value}</dd>
      {note && <dd className="mt-0.5 text-xs text-muted-foreground">{note}</dd>}
    </div>
  );
}

/** 완료 기록 카드의 내용. 상세 화면과 완료 순간의 창이 함께 쓴다. */
export function CompletionCard({ record, className }: { record: CompletionRecord; className?: string }) {
  const read = record.book ? '읽은' : '공부한';
  const target = describeTarget(record);
  const allUntimed = record.minutes === 0 && record.untimedRecords > 0;
  // 상세 화면 위에 완료 순간의 창이 뜨면 같은 카드가 둘이다. 제목 id가 겹치지 않게 한다.
  const titleId = useId();
  return (
    <Card
      role="group"
      aria-labelledby={titleId}
      className={cn('border-primary/30 bg-primary-soft p-4 md:p-6', className)}
    >
      <div className="flex items-center gap-2 text-primary">
        <Flag size={18} aria-hidden="true" />
        <h2 id={titleId} className="text-base font-semibold">
          {record.book ? '완독 기록' : '완료 기록'}
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {formatDate(record.startedOn, true)}부터 {formatDate(record.finishedOn, true)}까지 · {record.spanDays}일
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">
        <Stat label="시작일" value={formatDate(record.startedOn)} />
        <Stat label="완료일" value={formatDate(record.finishedOn)} />
        <Stat label={`실제 ${read} 날`} value={`${record.studyDays}일`} note={`${record.spanDays}일 중`} />
        <Stat
          label="하루 평균"
          value={amountText(record.dailyAverage, record.unitLabel)}
          note={`모두 ${amountText(record.amount, record.unitLabel)}`}
        />
        <Stat
          label="기록한 시간"
          value={allUntimed ? '적지 않음' : formatStudyMinutes(record.minutes)}
          {...(!allUntimed && record.untimedRecords > 0
            ? { note: `시간을 비운 기록 ${record.untimedRecords}번 제외` }
            : {})}
        />
        {target && (
          <Stat
            label="목표 대비"
            value={target}
            note={`목표 ${formatDate(record.targetDate)}`}
            {...(record.daysEarly! >= 0 ? { tone: 'good' as const } : {})}
          />
        )}
      </dl>
      <p className="mt-4 text-xs leading-5 text-muted-foreground">
        {record.book &&
          record.initial > 0 &&
          `등록할 때 이미 ${record.initial}쪽까지 읽어 둔 상태였어요. 그 분량은 하루 평균에 넣지 않았어요. `}
        복습과 취소한 기록은 세지 않았어요.
      </p>
    </Card>
  );
}

/** 상세 화면 맨 위의 완료 기록. 아직 끝나지 않았으면 아무것도 그리지 않는다. */
export function CompletionRecordCard({ data, resourceId }: { data: WorkspaceData; resourceId: string }) {
  const record = findCompletion(data, resourceId)?.record;
  return record ? <CompletionCard record={record} /> : null;
}

const CompletionContext = createContext<(resourceId: string) => void>(() => {});
/** 마지막 기록을 저장해 막 끝낸 순간에 완료 기록 창을 띄운다. */
export const useCompletionMoment = () => useContext(CompletionContext);

export function CompletionProvider({ children }: { children: ReactNode }) {
  const [resourceId, setResourceId] = useState<string | null>(null);
  return (
    <CompletionContext value={setResourceId}>
      {children}
      {resourceId && (
        <CompletionDialog key={resourceId} resourceId={resourceId} onClose={() => setResourceId(null)} />
      )}
    </CompletionContext>
  );
}

/**
 * 완료 순간의 창. 저장이 끝난 뒤에 열리므로 서재를 새로 읽어 방금 기록까지 넣어 계산한다.
 * 기록 창 위에 떠도 된다. 모달은 열린 순서대로 쌓인다.
 */
function CompletionDialog({ resourceId, onClose }: { resourceId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useSheetDialog(dialog);
  const { data, error } = useWorkspace();
  const pathname = usePathname();
  const found = data ? findCompletion(data, resourceId) : null;
  const book = found?.resource.workload_unit !== 'UNIT';
  const href = book ? `/resources/${resourceId}` : `/resources/materials/${resourceId}`;
  return (
    <dialog
      ref={dialog}
      aria-labelledby="completion-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={SHEET_DIALOG_CLASS}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="completion-title" className="text-xl font-semibold">
            {book ? '다 읽었어요' : '모두 마쳤어요'}
          </h2>
          {found && <p className="mt-1 truncate text-sm text-muted-foreground">{found.resource.title}</p>}
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="완료 기록 닫기" onClick={onClose}>
          <X size={20} />
        </Button>
      </header>
      {found?.record ? (
        <CompletionCard record={found.record} />
      ) : data || error ? (
        <p className="py-4 text-sm leading-6 text-muted-foreground">
          {error ? '완료 기록을 불러오지 못했어요. 상세 화면에서 다시 확인해 주세요.' : '완료 기록을 만들 기록이 없어요.'}
        </p>
      ) : (
        <Skeleton className="h-56 w-full" />
      )}
      <div className="mt-4 flex justify-end gap-2">
        {pathname !== href && (
          <Button asChild variant="outline">
            <Link href={href} onClick={onClose}>
              상세에서 보기
            </Link>
          </Button>
        )}
        <Button type="button" onClick={onClose}>
          닫기
        </Button>
      </div>
    </dialog>
  );
}
