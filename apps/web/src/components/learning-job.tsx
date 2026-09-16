'use client';
import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button } from './ui/button';
import { useAuth } from './auth-provider';
import type { LearningJob } from './learning-types';

/**
 * AI가 고른 표현을 복습함에 넣는 버튼.
 * 자동으로 넣지 않는다. 사용자가 고른 표현만 복습 대상이 된다.
 */
function SaveExpression({
  phrase,
  meaning,
  example,
  workspaceId,
}: {
  phrase: string;
  meaning: string;
  example: string;
  workspaceId: string | null;
}) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'duplicate' | 'failed'>('idle');
  if (state === 'saved' || state === 'duplicate')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check size={13} aria-hidden="true" />
        {state === 'saved' ? '복습함에 넣었어요' : '이미 저장한 표현이에요'}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={state === 'busy'}
        onClick={() => {
          setState('busy');
          void apiFetch('/api/learning/expressions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phrase, meaning, example, workspaceId }),
          })
            .then(async (response) => {
              if (response.ok) return setState('saved');
              const body = await response.json();
              setState(body.duplicate ? 'duplicate' : 'failed');
            })
            .catch(() => setState('failed'));
        }}
      >
        <Plus size={14} aria-hidden="true" />
        {state === 'busy' ? '넣는 중…' : '복습함에 넣기'}
      </Button>
      {state === 'failed' && (
        <span role="alert" className="text-xs text-danger">
          넣지 못했어요. 다시 눌러 주세요.
        </span>
      )}
    </span>
  );
}

export function LearningJobCard({
  job,
  retry,
  disabled,
  workspaceId = null,
}: {
  job: LearningJob;
  retry: () => void;
  disabled: boolean;
  workspaceId?: string | null;
}) {
  const output = job.output;
  return (
    <article className="space-y-3 rounded-xl bg-surface-subtle p-5">
      <h3 className="text-sm font-semibold">
        {job.kind === 'STUDY_SUMMARY' ? '학습 정리' : 'AI 피드백'}
      </h3>
      {job.status === 'QUEUED' || job.status === 'RUNNING' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {job.status === 'QUEUED'
            ? '순서를 기다리고 있어요.'
            : '피드백을 준비하고 있어요.'}{' '}
          다른 화면으로 이동해도 결과가 저장돼요.
        </p>
      ) : job.status === 'FAILED' ? (
        <div className="space-y-3">
          <p className="text-sm">
            AI 응답을 만들지 못했어요. 원문은 저장되어 있어요.
          </p>
          <Button variant="outline" disabled={disabled} onClick={retry}>
            응답 다시 요청
          </Button>
        </div>
      ) : (
        output && (
          <>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {output.summary}
            </p>
            {output.corrections.map((c, i) => (
              <div
                key={i}
                className="space-y-2 rounded-lg border border-border p-3 text-sm"
              >
                <p className="text-muted-foreground">원문: {c.original}</p>
                <p>수정: {c.revised}</p>
                <p className="text-muted-foreground">{c.reason}</p>
              </div>
            ))}
            {!!output.expressions.length && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">기억할 표현</h4>
                {output.expressions.map((e, i) => (
                  <div key={i} className="space-y-1.5 text-sm leading-6">
                    <p>
                      <strong>{e.phrase}</strong> · {e.meaning}
                    </p>
                    <p className="text-muted-foreground">{e.example}</p>
                    <SaveExpression
                      phrase={e.phrase}
                      meaning={e.meaning}
                      example={e.example}
                      workspaceId={workspaceId}
                    />
                  </div>
                ))}
              </div>
            )}
            {output.nextPrompt && (
              <p className="rounded-lg border border-border p-3 text-sm leading-6">
                다음 연습: {output.nextPrompt}
              </p>
            )}
          </>
        )
      )}
    </article>
  );
}
