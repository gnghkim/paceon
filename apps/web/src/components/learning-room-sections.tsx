import { Button } from './ui/button';
import { learningDuration, type LearningSession } from './learning-types';
import { sessionStatusLabel } from './learning-room-view';

export function DraftRecovery({ localText, cloudText, busy, onRestore, onUseCloud }: {
  localText: string;
  cloudText: string;
  busy: boolean;
  onRestore: () => void;
  onUseCloud: () => void;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-primary p-4">
      <h2 className="font-semibold">저장하지 못한 초안이 있어요</h2>
      <p className="text-sm">
        클라우드 글과 다른 내용이에요. 복원할 글을 확인해 주세요.
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm">
          이 기기의 초안 보기
        </summary>
        <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">
          {localText}
        </p>
      </details>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm">
          클라우드 초안 보기
        </summary>
        <p className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">
          {cloudText || '(빈 초안)'}
        </p>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={onRestore}>
          이 초안으로 복원
        </Button>
        <Button variant="outline" disabled={busy} onClick={onUseCloud}>
          클라우드 글 사용
        </Button>
      </div>
    </section>
  );
}

export function SessionHistory({ sessions }: { sessions: LearningSession[] }) {
  if (!sessions.length) return null;
  return (
    <details className="rounded-xl border border-border p-4">
      <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
        학습 시간 기록 {sessions.length}개
      </summary>
      {sessions.map((s) => (
        <p key={s.id} className="py-2 text-sm text-muted-foreground">
          {new Date(s.started_at).toLocaleString('ko-KR')} ·{' '}
          {learningDuration(s.elapsed_seconds)} ·{' '}
          {sessionStatusLabel(s.status)}
        </p>
      ))}
    </details>
  );
}
