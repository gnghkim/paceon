import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisSchema, coachSchema } from '../packages/ai-schema/src/index.ts';
import { buildAiContext } from '../apps/web/src/lib/ai-context.ts';

const book = { title: 'Book', author: 'Author', total_pages: 100, initial_completed_workload: 10 };
const event = { id: 'read', event_type: 'LEARNING', start_page: 11, end_page: 20, completed_workload: 10, study_date: '2026-09-13', duration_minutes: 20, memo: 'PRIVATE' };
const input = { book, plan: null, events: [event], today: '2026-09-13', kind: 'COACH', outline: '' };
test('AI output schemas reject invented fields, bad confidence and unbounded text', () => {
  const value = { difficulty: 'MODERATE', estimatedMinutes: 100, importance: 'MEDIUM', confidence: 0.4, summary: 'Metadata estimate', reasons: ['Limited evidence'] };
  assert.deepEqual(analysisSchema.parse(value), value);
  for (const invalid of [{ ...value, confidence: 2 }, { ...value, estimatedMinutes: -1 }, { ...value, mastery: 90 }, { ...value, reasons: [] }]) assert.equal(analysisSchema.safeParse(invalid).success, false);
  assert.equal(coachSchema.safeParse({ summary: 'x'.repeat(801), suggestions: ['Read'], confidence: 0.4 }).success, false);
});
test('context sends deterministic facts without private memos or review duplication', () => {
  const context = buildAiContext({ ...input, events: [event, { ...event, id: 'review', event_type: 'REVIEW', duration_minutes: 100 }] });
  assert.equal(context.facts.completedPages, 20);
  assert.equal(context.facts.recentLearningMinutes, 20);
  assert.equal(context.facts.validTimedSamples, 1);
  assert.equal(context.facts.remainingPages, 80);
  assert.equal(JSON.stringify(context).includes('PRIVATE'), false);
  assert.match(context.sourceRevision, /^[a-f0-9]{64}$/);
});
test('voided readings do not influence AI evidence and revisions change with facts', () => {
  const previous = buildAiContext(input);
  const corrected = buildAiContext({ ...input, events: [event, { id: 'void', event_type: 'VOID', voids_event_id: 'read' }] });
  assert.equal(corrected.facts.completedPages, 10);
  assert.equal(corrected.facts.recentLearningMinutes, 0);
  assert.notEqual(previous.sourceRevision, corrected.sourceRevision);
  assert.equal(previous.sourceRevision, buildAiContext(input).sourceRevision);
});
