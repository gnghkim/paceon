'use client';
import { Button } from './ui/button';
import type { LearningJob } from './learning-types';

export function LearningJobCard({
  job,
  retry,
  disabled,
}: {
  job: LearningJob;
  retry: () => void;
  disabled: boolean;
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
                  <div key={i} className="text-sm leading-6">
                    <p>
                      <strong>{e.phrase}</strong> · {e.meaning}
                    </p>
                    <p className="text-muted-foreground">{e.example}</p>
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
