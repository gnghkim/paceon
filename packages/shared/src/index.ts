/** Algorithm policies are defined in Phase 2; these are domain identifiers only. */
export type PlanMode = 'DEADLINE' | 'PACE' | 'BALANCED';

/** A successful liveness check does not imply database or AI readiness. */
export interface HealthResponse {
  status: 'ok';
  service: 'web' | 'ai-worker';
  check: 'liveness';
}
