import type { PlanMode } from '@paceon/shared';

/** Package boundary only. Scheduling algorithms are not implemented in Phase 0. */
export const schedulerContract = {
  implementation: 'foundation',
  modes: ['DEADLINE', 'PACE', 'BALANCED'] as const satisfies readonly PlanMode[],
} as const;
