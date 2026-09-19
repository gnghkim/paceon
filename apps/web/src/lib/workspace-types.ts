import type {
  Tables,
  Resource,
  Plan,
  ScheduleSession,
  AvailabilityRule,
  ProgressEvent,
  ReplanRun,
} from '@paceon/shared';
export type PushSubscriptionRow = Tables<'push_subscriptions'>;

export interface WorkspaceData {
  /** 쪽으로 읽는 자료(책). 기존 화면은 이것만 본다. */
  resources: Resource[];
  /** 챕터로 공부하는 자료(교재, 강의). 진도는 숫자 하나가 아니라 챕터별 완료다. */
  materials: Resource[];
  /** 조회 기간의 일정이 가리키는 챕터. 일정 카드에 제목을 보여 주는 데 쓴다. */
  units: Record<string, { title: string; minutes: number | null }>;
  materialProgress: Record<string, { done: number; total: number; percent: number }>;
  plans: Plan[];
  sessions: ScheduleSession[];
  progress: Record<string, { completedThroughPage: number; percent: number; latestLearningId: string | null }>;
  events: ProgressEvent[];
  replans: ReplanRun[];
  availability: AvailabilityRule[];
  timezone: string;
  /** null이면 목표를 정하지 않은 상태이며 어떤 화면도 목표를 보여 주지 않는다. */
  dailyLearningMinutes: number | null;
  /** "HH:MM" 형식의 알림 시각. null이면 알림을 보내지 않는다. */
  notifyAt: string | null;
  today: string;
  from: string;
  to: string;
}
