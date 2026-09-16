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
  /** null이면 목표를 정하지 않은 상태이며 어떤 화면도 목표를 보여 주지 않는다. */
  dailyLearningMinutes: number | null;
  today: string;
  from: string;
  to: string;
}
