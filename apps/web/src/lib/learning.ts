import { z } from 'zod';

export const learningKindSchema = z.enum(['LISTENING', 'SPEAKING', 'WRITING']);
export type LearningKind = z.infer<typeof learningKindSchema>;
const uuid = z.uuid();
const base = { requestId: uuid };
const workspace = { ...base, workspaceId: uuid };
const device = { ...base, sessionId: uuid, deviceId: uuid, generation: z.number().int().min(1).max(2147483647) };
const timezone = z.string().min(1).max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
  catch { return false; }
});
export const learningCommandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action:z.literal('CREATE'), ...workspace, title:z.string().trim().min(1).max(120), prompt:z.string().max(1000).default(''), kind:z.enum(['SPEAKING','WRITING']) }),
  z.strictObject({ action:z.literal('SAVE_DRAFT'), ...workspace, expectedVersion:z.number().int().min(0), draft:z.string().max(8000) }),
  z.strictObject({ action:z.literal('START'), ...workspace, deviceId:uuid, timezone }),
  z.strictObject({ action:z.literal('TAKEOVER'), ...workspace, deviceId:uuid, timezone }),
  z.strictObject({ action:z.literal('HEARTBEAT'), ...device, activity:z.boolean() }),
  z.strictObject({ action:z.literal('PAUSE'), ...device, activity:z.boolean(), reason:z.enum(['MANUAL','IDLE','HIDDEN']) }),
  z.strictObject({ action:z.literal('END'), ...device, activity:z.boolean() }),
  z.strictObject({ action:z.literal('MESSAGE'), ...workspace, sessionId:uuid, deviceId:uuid, generation:z.number().int().min(1).max(2147483647), content:z.string().min(1).max(8000).refine(value=>value.trim().length>0) }),
  z.strictObject({ action:z.literal('SUMMARY'), ...workspace, sessionId:uuid }),
  z.strictObject({ action:z.literal('RETRY'), ...base, jobId:uuid }),
]);
export type LearningCommand = z.infer<typeof learningCommandSchema>;
export const parseLearningCommand = (value: unknown): LearningCommand => learningCommandSchema.parse(value);

export const learningOutputSchema = z.strictObject({
  summary:z.string().trim().min(1).max(2000),
  corrections:z.array(z.strictObject({original:z.string().trim().min(1).max(2000),revised:z.string().trim().min(1).max(2000),reason:z.string().trim().min(1).max(600)})).max(3),
  expressions:z.array(z.strictObject({phrase:z.string().trim().min(1).max(200),meaning:z.string().trim().min(1).max(600),example:z.string().trim().min(1).max(1000)})).max(10),
  nextPrompt:z.string().trim().min(1).max(1000),
});
export type LearningOutput = z.infer<typeof learningOutputSchema>;

export function publicLearningJob(row: Record<string, unknown>) {
  const parsed = row.status === 'SUCCEEDED' ? learningOutputSchema.safeParse(row.output) : null;
  const valid = parsed?.success === true;
  const invalid = row.status === 'SUCCEEDED' && !valid;
  const safeCodes = new Set(['INVALID_INPUT','INVALID_OUTPUT','PROVIDER_ERROR','PROVIDER_INCOMPLETE','PROVIDER_REFUSAL','WORKER_TIMEOUT','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE']);
  return {
    id:row.id, workspace_id:row.workspace_id, session_id:row.session_id ?? null,
    kind:row.kind, status:invalid ? 'FAILED' : row.status,
    output:valid ? parsed.data : null,
    error_code:invalid ? 'INVALID_OUTPUT' : typeof row.error_code === 'string' ? (safeCodes.has(row.error_code) ? row.error_code : 'PROVIDER_ERROR') : null,
    created_at:row.created_at, updated_at:row.updated_at,
  };
}

export function parseLearningListQuery(params: URLSearchParams): { offset: string; kind: LearningKind | null } | null {
  if ([...params.keys()].some(key => key !== 'offset' && key !== 'kind') || params.getAll('offset').length > 1 || params.getAll('kind').length > 1) return null;
  const offset = params.get('offset') ?? '0', kind = params.get('kind');
  if (!/^\d+$/.test(offset) || Number(offset) > 100000) return null;
  if (kind !== null && !learningKindSchema.safeParse(kind).success) return null;
  return { offset, kind: kind as LearningKind | null };
}
