import type {
  Resource,
  Plan,
  ScheduleSession,
  AvailabilityRule,
} from '@paceon/shared';
export interface WorkspaceData {
  resources: Resource[];
  plans: Plan[];
  sessions: ScheduleSession[];
  availability: AvailabilityRule[];
  timezone: string;
  today: string;
  from: string;
  to: string;
}
