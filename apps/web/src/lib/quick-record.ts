import type { WorkspaceData } from './workspace-types';

export function recordableBooks(
  data: Pick<WorkspaceData, 'resources' | 'plans' | 'sessions' | 'today'>,
) {
  const today = new Set(
    data.sessions
      .filter((s) => s.study_date === data.today && s.status !== 'SKIPPED')
      .map((s) => s.resource_id),
  );
  return data.resources
    .flatMap((book) => {
      if (book.type !== 'BOOK' || book.status === 'ARCHIVED') return [];
      const plans = data.plans.filter((p) => p.resource_id === book.id);
      // A paused current plan must not fall back to completed history.
      const current = plans.find(
        (p) => p.status === 'ACTIVE' || p.status === 'PAUSED',
      );
      const plan =
        current ??
        plans
          .filter((p) => p.status === 'COMPLETED')
          .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      return plan && plan.status !== 'PAUSED' ? [{ book, plan }] : [];
    })
    .sort(
      (a, b) => Number(today.has(b.book.id)) - Number(today.has(a.book.id)),
    );
}

export const WORKSPACE_CHANGED = 'paceon:workspace-changed';
