import type { AiKind, BookAnalysis, CoachInsight } from '@paceon/ai-schema';
export type { AiKind, BookAnalysis, CoachInsight } from '@paceon/ai-schema';
export interface AiJobView {
  id: string;
  kind: AiKind;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  result: BookAnalysis | CoachInsight | null;
  model: string | null;
  errorCode: string | null;
  sourceRevision: string;
  createdAt: string;
  updatedAt: string;
}
export interface AiJobsResponse {
  available: boolean;
  sourceRevision: string;
  sourceRevisions: Record<AiKind, string>;
  jobs: AiJobView[];
}
