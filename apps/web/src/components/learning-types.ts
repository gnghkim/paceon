export interface LearningWorkspace {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  draft: string;
  draft_version: number;
  created_at: string;
  updated_at: string;
}
export interface LearningSession {
  id: string;
  workspace_id: string;
  status: 'ACTIVE' | 'PAUSED' | 'ENDED';
  pause_reason: string | null;
  device_id: string;
  generation: number;
  lease_expires_at: string;
  last_seen_at: string;
  last_activity_at: string;
  elapsed_seconds: number;
  started_at: string;
  ended_at: string | null;
  updated_at: string;
}
export interface LearningOutput {
  summary: string;
  corrections: { original: string; revised: string; reason: string }[];
  expressions: { phrase: string; meaning: string; example: string }[];
  nextPrompt: string;
}
export interface LearningJob {
  id: string;
  session_id: string | null;
  kind: 'WRITING_REPLY' | 'STUDY_SUMMARY';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  output: LearningOutput | null;
  created_at: string;
}
export interface LearningMessage {
  id: string;
  session_id: string | null;
  role: 'USER' | 'ASSISTANT';
  content: string;
  created_at: string;
  job_id: string | null;
}
export interface LearningSnapshot {
  video?: LearningVideo | null;
  videoNotes?: LearningVideoNote[];
  videoVisits?: LearningVideoVisit[];
  page?: number;
  hasMore?: { sessions: boolean; messages: boolean; jobs: boolean };
  workspace: LearningWorkspace;
  sessions: LearningSession[];
  messages: LearningMessage[];
  jobs: LearningJob[];
  aiEnabled: boolean;
}
export interface LearningList {
  videos?: LearningVideo[];
  nextOffset?: number | null;
  workspaces: LearningWorkspace[];
  sessions: LearningSession[];
  aiEnabled: boolean;
}
export interface LearningVideo {
  workspace_id: string;
  video_id: string;
  start_seconds: number;
  position_seconds: number;
  duration_seconds: number | null;
  favorite: boolean;
  archived: boolean;
  transcript: string;
  transcript_version: number;
  context_start: number;
  context_end: number;
}
export interface LearningVideoNote {
  id: string;
  position_seconds: number;
  content: string;
  created_at: string;
}
export interface LearningVideoVisit {
  id: string;
  from_seconds: number;
  to_seconds: number;
  rate: number;
  created_at: string;
}
export function learningDuration(seconds: number) {
  const n = Math.max(0, Math.floor(seconds));
  return (
    (n >= 3600
      ? `${Math.floor(n / 3600)
          .toString()
          .padStart(2, '0')}:`
      : '') +
    `${Math.floor(n / 60) % 60}`.padStart(2, '0') +
    ':' +
    `${n % 60}`.padStart(2, '0')
  );
}
