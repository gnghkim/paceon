'use client';

import Link from 'next/link';
import { GraduationCap } from 'lucide-react';
import type { WorkspaceData } from '@/lib/workspace-types';
import { formatDate } from '@/lib/planning';

/**
 * 서재의 교재·강의 목록. 하나도 없으면 자리를 차지하지 않는다.
 * 책은 쪽으로, 여기 자료는 챕터로 진도를 말한다.
 */
export function MaterialList({ data, items }: { data: WorkspaceData; items: WorkspaceData['materials'] }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="materials-title" className="space-y-3">
      <h2 id="materials-title" className="text-sm font-semibold text-muted-foreground">
        교재·강의
      </h2>
      <ul className="space-y-3">
        {items.map((item) => {
          const progress = data.materialProgress[item.id] ?? { done: 0, total: item.total_units ?? 0, percent: 0 };
          const plan = data.plans.find((candidate) => candidate.resource_id === item.id);
          return (
            <li key={item.id}>
              <Link
                href={`/resources/materials/${item.id}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 hover:border-primary/40"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <GraduationCap size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{item.title}</span>
                  {item.author && <span className="mt-1 block truncate text-sm text-muted-foreground">{item.author}</span>}
                  <span className="mt-1 block text-sm text-muted-foreground">
                    {progress.done} / {progress.total}
                    {item.unit_label ?? ''}
                    {plan?.status === 'PAUSED'
                      ? ' · 멈춤'
                      : plan?.status === 'COMPLETED'
                        ? ' · 모두 마침'
                        : plan?.forecast_date
                          ? ` · 예상 완료 ${formatDate(plan.forecast_date)}`
                          : ' · 계획 없음'}
                  </span>
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${progress.percent}%` }} />
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
