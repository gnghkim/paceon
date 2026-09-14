import type {
  Resource,
  Plan,
  ScheduleSession,
  AvailabilityRule,
  ProgressEvent,
  ReplanRun,
} from '@paceon/shared';
export interface WorkspaceData {
  resources: Resource[];
  plans: Plan[];
  sessions: ScheduleSession[];
  progress: Record<string, { completedThroughPage: number; percent: number; latestLearningId: string | null }>;
  events: ProgressEvent[];
  replans: ReplanRun[];
  availability: AvailabilityRule[];
  timezone: string;
  today: string;
  from: string;
  to: string;
}
