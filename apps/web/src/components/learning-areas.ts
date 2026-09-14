import type { LearningKind, LearningList, LearningWorkspace } from './learning-types';

export type LearningAreaSlug = 'listening' | 'speaking' | 'writing';
export const LAST_AREA_KEY = 'paceon:learn:last-area';
export const learningAreas: readonly { kind: LearningKind; slug: LearningAreaSlug; label: string }[] = [
  { kind: 'LISTENING', slug: 'listening', label: '리스닝' },
  { kind: 'SPEAKING', slug: 'speaking', label: '스피킹' },
  { kind: 'WRITING', slug: 'writing', label: '라이팅' },
];

export const resolveLearningArea = (stored: string | null): LearningAreaSlug =>
  learningAreas.find(area => area.slug === stored)?.slug ?? 'listening';

export const areaForKind = (kind: LearningKind) => learningAreas.find(area => area.kind === kind) ?? learningAreas[0];

export const workspaceHref = (workspace: { id: string; kind: LearningKind }) =>
  workspace.kind === 'LISTENING' ? `/learn/items/${workspace.id}` : `/learn/${workspace.id}`;

/** Listening keeps questions and shadowing; writing only lists speech recorded before the area split. */
export const learningRoomFeatures = (kind: LearningKind) => ({
  video: kind === 'LISTENING',
  writing: kind !== 'SPEAKING',
  speech: kind !== 'WRITING',
  legacySpeech: kind === 'WRITING',
});

export function resumeWorkspaces(list: LearningList | null, limit = 3): LearningWorkspace[] {
  if (!list) return [];
  const archived = new Set((list.videos ?? []).filter(video => video.archived).map(video => video.workspace_id));
  return list.workspaces
    .filter(workspace => !archived.has(workspace.id))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}
