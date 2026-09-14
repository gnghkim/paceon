import { z } from 'zod';

export const aiKindSchema = z.enum(['BOOK_ANALYSIS', 'COACH']);
export type AiKind = z.infer<typeof aiKindSchema>;
export const analysisSchema = z.object({
  difficulty: z.enum(['EASY', 'MODERATE', 'CHALLENGING']),
  estimatedMinutes: z.number().int().min(1).max(10_000_000),
  importance: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(600),
  reasons: z.array(z.string().min(1).max(300)).min(1).max(4),
}).strict();
export const coachSchema = z.object({
  summary: z.string().min(1).max(800),
  suggestions: z.array(z.string().min(1).max(300)).min(1).max(3),
  confidence: z.number().min(0).max(1),
}).strict();
export type BookAnalysis = z.infer<typeof analysisSchema>;
export type CoachInsight = z.infer<typeof coachSchema>;
export const aiRequestSchema = z.object({
  kind: aiKindSchema, outline: z.string().trim().max(12000).default(''),
}).strict().refine(value => value.kind === 'BOOK_ANALYSIS' || value.outline === '', '코칭에는 목차를 입력하지 않습니다.');

export interface AiContext {
  schemaVersion: 1;
  kind: AiKind;
  book: { title: string; authors: string[]; totalPages: number; description: string };
  outline: string;
  facts: {
    today: string; completedPages: number; remainingPages: number; progressPercent: number;
    planMode: string | null; forecastDate: string | null; targetDate: string | null;
    replanRequired: boolean; recentLearningPages: number; recentLearningMinutes: number; validTimedSamples: number;
  };
  sourceRevision: string;
}
