import type { Database, Tables } from './database.types';

export type { Database, Tables, TablesInsert, TablesUpdate, Enums, Json } from './database.types';

/** Algorithm policies are defined in Phase 2; identifiers come from the DB schema. */
export type PlanMode = Database['public']['Enums']['plan_mode'];
export type Resource = Tables<'resources'>;
export type ResourceUnit = Tables<'resource_units'>;
export type Goal = Tables<'goals'>;
export type Plan = Tables<'plans'>;
export type AvailabilityRule = Tables<'availability_rules'>;
export type ScheduleSession = Tables<'schedule_sessions'>;
export type ProgressEvent = Tables<'progress_events'>;
export type ReplanRun = Tables<'replan_runs'>;
export type LearnerProfile = Tables<'learner_profiles'>;

/** A successful liveness check does not imply database or AI readiness. */
export interface HealthResponse {
  status: 'ok';
  service: 'web' | 'ai-worker';
  check: 'liveness';
}
