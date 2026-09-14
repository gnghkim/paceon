import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, createBookHandlers, json, readBody, type Config } from './books-api.ts';

const MAX_BYTES = 10 * 1024 * 1024;
const publicColumns = 'id,workspace_id,session_id,kind,status,reference_text,original_text,edited_text,feedback,mime_type,file_size,duration_seconds,keep_audio,expires_at,audio_deleted_at,error_code,created_at,updated_at';
const common = { requestId: z.uuid(), id: z.uuid() };
const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('PROMPT'), ...common, workspaceId: z.uuid(), level: z.enum(['EASY', 'MEDIUM']), topic: z.string().trim().max(200) }),
  z.strictObject({ action: z.literal('EDIT'), ...common, text: z.string().max(8000) }),
  z.strictObject({ action: z.literal('DELETE'), ...common }),
  z.strictObject({ action: z.literal('DELETE_AUDIO'), ...common }),
  z.strictObject({ action: z.literal('KEEP'), ...common, keep: z.boolean() }),
  z.strictObject({ action: z.literal('RETRY'), ...common }),
  z.strictObject({ action: z.literal('SPEECH_TICK'), requestId: z.uuid(), sessionId: z.uuid(), deviceId: z.uuid(), generation: z.number().int().positive(), playing: z.boolean() }),
]);
const errorMessages: Record<string, [number, string]> = {
  LEARNING_NOT_FOUND: [404, '녹음이나 학습 자료를 찾을 수 없어요.'],
  LEARNING_CONFLICT: [409, '녹음 또는 학습 상태가 바뀌었어요. 최신 상태를 확인해 주세요.'],
  LEARNING_INVALID: [400, '녹음과 입력 내용을 확인해 주세요.'],
  LEARNING_LIMIT: [429, '음성 요청 한도에 도달했어요. 잠시 후 다시 시도해 주세요.'],
};

async function boundedBytes(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  const reader = body?.getReader();
  if (!reader) throw new ApiError(400, '녹음이 비어 있어요.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => undefined); }, 60000);
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new ApiError(413, '녹음은 최대 10MiB까지 전송할 수 있어요.');
      }
      chunks.push(value);
    }
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  if (timedOut || !completed || !size) throw new ApiError(400, '녹음이 비어 있거나 전송이 중단되었어요.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function audioFormat(bytes: Uint8Array, mime: string) {
  const ascii = (from: number, to: number) => new TextDecoder().decode(bytes.subarray(from, to));
  return bytes.length >= 12 && (
    (mime === 'audio/webm' && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) ||
    (mime === 'audio/mp4' && ascii(4, 8) === 'ftyp') ||
    (mime === 'audio/ogg' && ascii(0, 4) === 'OggS') ||
    (mime === 'audio/wav' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE')
  );
}

export function createSpeechHandlers(config: Config | undefined, enabled: boolean, fetcher: typeof fetch = globalThis.fetch) {
  const authenticate = createBookHandlers(config, fetcher).authenticate;
  type Auth = Awaited<ReturnType<typeof authenticate>>;
  async function db(auth: Auth, path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    const url = new URL(`/rest/v1/${path}`, auth.base);
    url.search = new URLSearchParams(query).toString();
    const response = await fetcher(url, {
      headers: { ...auth.headers, 'Content-Type': 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      const mapped = typeof error?.message === 'string' ? errorMessages[error.message] : undefined;
      if (mapped) throw new ApiError(...mapped);
      throw new ApiError(response.status === 401 ? 401 : 503, '음성 처리 상태를 확인하지 못했어요. 같은 요청으로 다시 시도해 주세요.');
    }
    return response.json();
  }
  const rpc = (auth: Auth, name: string, body: unknown) => db(auth, `rpc/${name}`, {}, body);
  function fail(error: unknown) {
    if (error instanceof ApiError) return json({ error: /[가-힣]/.test(error.message) ? error.message : '로그인과 요청 내용을 확인해 주세요.' }, error.status);
    if (error instanceof z.ZodError || error instanceof URIError) return json({ error: '녹음과 입력 형식을 확인해 주세요.' }, 400);
    return json({ error: '연결을 확인하고 같은 요청으로 다시 시도해 주세요.' }, 503);
  }
  return {
    async LIST(request: Request) {
      try {
        const auth = await authenticate(request);
        const workspaceId = z.uuid().parse(new URL(request.url).searchParams.get('workspaceId'));
        const items = await db(auth, 'learning_speech', { select: publicColumns, workspace_id: `eq.${workspaceId}`, user_id: `eq.${auth.userId}`, status: 'neq.DELETED', order: 'created_at.desc,id.desc', limit: '100' });
        if (!Array.isArray(items)) throw new ApiError(503, '음성 목록을 확인하지 못했어요.');
        return json({ items, enabled });
      } catch (error) { return fail(error); }
    },
    async COMMAND(request: Request) {
      try {
        const auth = await authenticate(request);
        const command = commandSchema.parse(await readBody(request, 40000));
        if (!enabled && (command.action === 'PROMPT' || command.action === 'RETRY')) throw new ApiError(503, 'AI 음성 분석이 아직 연결되지 않았어요.');
        return json(await rpc(auth, 'learning_speech_command', { p_command: command }));
      } catch (error) { return fail(error); }
    },
    async UPLOAD(request: Request) {
      try {
        const auth = await authenticate(request);
        if (!enabled) throw new ApiError(503, 'AI 음성 분석이 아직 연결되지 않았어요. 녹음을 기기에 보관해 주세요.');
        const id = z.uuid().parse(request.headers.get('x-speech-id'));
        const workspaceId = z.uuid().parse(request.headers.get('x-workspace-id'));
        const sessionId = z.uuid().nullable().parse(request.headers.get('x-session-id'));
        const reference = z.string().max(2000).parse(decodeURIComponent(request.headers.get('x-reference-text') ?? ''));
        const mime = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(mime)) throw new ApiError(415, '이 녹음 형식은 지원하지 않아요. WebM, MP4, Ogg, WAV를 사용해 주세요.');
        const length = request.headers.get('content-length');
        if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new ApiError(413, '녹음은 최대 10MiB까지 전송할 수 있어요.');
        const bytes = await boundedBytes(request.body);
        if (!audioFormat(bytes, mime)) throw new ApiError(400, '올바른 음성 파일인지 확인해 주세요.');
        let item = await rpc(auth, 'begin_speech_upload', {
          p_id: id, p_workspace_id: workspaceId, p_session_id: sessionId, p_reference_text: reference,
          p_mime_type: mime, p_file_size: bytes.byteLength, p_content_sha256: createHash('sha256').update(bytes).digest('hex'),
        }) as { status: string };
        if (item.status === 'UPLOADING') {
          const response = await fetcher(new URL(`/storage/v1/object/learning-audio/${auth.userId}/${id}/recording`, auth.base), {
            method: 'POST', headers: { ...auth.headers, 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes,
            cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60000),
          });
          let duplicate = response.status === 409;
          if (!response.ok && response.status === 400) {
            const body = await response.json().catch(() => null);
            duplicate = body?.error === 'Duplicate' && String(body?.statusCode) === '409';
          }
          if (!response.ok && !duplicate) throw new ApiError(503, '녹음 전송을 확인하지 못했어요. 같은 녹음으로 다시 시도해 주세요.');
          item = await rpc(auth, 'queue_speech_recording', { p_id: id }) as { status: string };
        }
        return json({ item }, 202);
      } catch (error) { return fail(error); }
    },
    async AUDIO(request: Request, id: string) {
      try {
        const auth = await authenticate(request);
        z.uuid().parse(id);
        const source = await rpc(auth, 'speech_audio_path', { p_id: id }) as { storage_path?: string; mime_type?: string } | null;
        if (!source?.storage_path) throw new ApiError(404, '음성이 없거나 보관 기간이 지났어요.');
        if (![`${auth.userId}/${id}/recording`, `${auth.userId}/${id}/sample.mp3`].includes(source.storage_path)) throw new ApiError(409, '음성 파일 정보를 확인해 주세요.');
        if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/mpeg'].includes(source.mime_type ?? '')) throw new ApiError(409, '음성 형식을 확인해 주세요.');
        const response = await fetcher(new URL(`/storage/v1/object/authenticated/learning-audio/${source.storage_path}`, auth.base), {
          headers: auth.headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new ApiError(response.status === 404 ? 404 : 503, '음성을 불러오지 못했어요.');
        const bytes = await boundedBytes(response.body);
        return new Response(bytes, { headers: { 'Content-Type': source.mime_type!, 'Content-Length': String(bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      } catch (error) { return fail(error); }
    },
  };
}
