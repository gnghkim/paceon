import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const scope = 'https://www.googleapis.com/auth/youtube.readonly';
type Config = { clientId: string; clientSecret: string; encryptionKey: string; appUrl: string; supabaseUrl: string; publicKey: string; serviceKey: string };
type Tokens = { access: string; refresh: string; expires: number };
type Stored = { user_id: string; generation: string; tokens: string; verifier: string };
type Item = { id: string; title: string; kind: 'video' | 'playlist' | 'channel' };
class YouTubeError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
const hash = (value: string) => createHash('sha256').update(value).digest('base64url');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const failure = (error: unknown) => error instanceof YouTubeError ? json({ error: error.message }, error.status) : json({ error: 'YouTube 서비스를 잠시 사용할 수 없습니다.' }, 503);

export function readYouTubeConfig(env: Record<string, string | undefined> = process.env): Config | undefined {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, YOUTUBE_TOKEN_ENCRYPTION_KEY: encryptionKey, APP_URL: appUrl, NEXT_PUBLIC_SUPABASE_URL: supabaseUrl, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = env;
  if (!clientId || !clientSecret || !encryptionKey || !appUrl || !supabaseUrl || !publicKey || !serviceKey) return;
  try {
    const url = new URL(appUrl);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return;
    if (Buffer.from(encryptionKey, 'base64').length !== 32 || Buffer.from(encryptionKey, 'base64').toString('base64') !== encryptionKey) return;
    return { clientId, clientSecret, encryptionKey, appUrl: url.origin, supabaseUrl, publicKey, serviceKey };
  } catch { return; }
}
export function seal(value: unknown, config: Config, userId: string): string {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), nonce);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unseal<T = unknown>(value: string, config: Config, userId: string): T {
  const bytes = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), bytes.subarray(0, 12));
  cipher.setAuthTag(bytes.subarray(12, 28)); cipher.setAAD(Buffer.from(userId));
  return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8')) as T;
}

export function createYouTubeHandlers(config: Config | undefined, fetcher: typeof fetch = globalThis.fetch) {
  function configured(): Config { if (!config) throw new YouTubeError(503, 'YouTube 계정 연결 설정이 아직 준비되지 않았습니다. 링크 저장은 이용할 수 있습니다.'); return config; }
  async function call(url: string | URL, init: RequestInit = {}) { return fetcher(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  async function authenticate(request: Request) {
    const c = configured(), authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer [^\s]+$/i.test(authorization)) throw new YouTubeError(401, '로그인이 필요합니다.');
    const result = await call(new URL('/auth/v1/user', c.supabaseUrl), { headers: { apikey: c.publicKey, Authorization: authorization } });
    if (!result.ok) throw new YouTubeError(result.status === 401 || result.status === 403 ? 401 : 503, '로그인을 확인할 수 없습니다.');
    const user = await result.json(); if (!user?.id || typeof user.id !== 'string') throw new YouTubeError(401, '로그인이 필요합니다.');
    return user.id as string;
  }
  async function store<T>(command: Record<string, unknown>): Promise<T> {
    const c = configured(); const result = await call(new URL('/rest/v1/rpc/youtube_connection_command', c.supabaseUrl), {
      method: 'POST', headers: { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_command: command }),
    });
    if (!result.ok) throw new YouTubeError(503, 'YouTube 연결 저장소를 사용할 수 없습니다.');
    return result.json() as Promise<T>;
  }
  async function token(parameters: Record<string, string>, previous?: Tokens): Promise<Tokens> {
    const c = configured(); const result = await call('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...parameters, client_id: c.clientId, client_secret: c.clientSecret }) });
    if (!result.ok) {
      const body = await result.json().catch(() => ({}));
      if (body.error === 'invalid_grant') throw new YouTubeError(409, 'YouTube 권한이 만료되거나 철회되었습니다. 다시 연결해 주세요.');
      throw new YouTubeError(503, 'Google 인증 서비스를 사용할 수 없습니다.');
    }
    const body = await result.json();
    if (body.scope && !String(body.scope).split(' ').includes(scope)) throw new YouTubeError(409, 'YouTube 읽기 권한이 필요합니다. 다시 연결해 주세요.');
    if (typeof body.access_token !== 'string' || !body.access_token || body.access_token.length > 16384 || (body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !body.refresh_token || body.refresh_token.length > 16384)) || !(body.refresh_token || previous?.refresh) || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in < 0 || body.expires_in > 86400) throw new YouTubeError(503, 'Google 인증 응답을 확인할 수 없습니다.');
    return { access: body.access_token, refresh: body.refresh_token || previous!.refresh, expires: Date.now() + body.expires_in * 1000 };
  }
  async function access(userId: string) {
    const c = configured(), row = await store<Stored | null>({ action: 'get', userId });
    if (!row) throw new YouTubeError(409, 'YouTube 계정을 연결해 주세요.');
    let tokens = unseal<Tokens>(row.tokens, c, userId);
    if (tokens.expires < Date.now() + 60000) {
      try { tokens = await token({ grant_type: 'refresh_token', refresh_token: tokens.refresh }, tokens); }
      catch (error) {
        if (error instanceof YouTubeError && error.status === 409) await store({ action: 'invalidate', userId, generation: row.generation, previous: row.tokens });
        throw error;
      }
      const updated = await store<boolean>({ action: 'refresh', userId, generation: row.generation, previous: row.tokens, tokens: seal(tokens, c, userId) });
      if (!updated) throw new YouTubeError(409, '연결 상태가 변경되었습니다. 다시 조회해 주세요.');
    }
    return tokens.access;
  }
  async function data(accessToken: string, resource: string, parameters: Record<string, string>) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`); url.search = new URLSearchParams(parameters).toString();
    const result = await call(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!result.ok) {
      const body = await result.json().catch(() => ({}));
      const reason = body.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || result.status === 429) throw new YouTubeError(429, 'YouTube 조회 한도를 초과했습니다. 나중에 다시 시도해 주세요.');
      if (result.status === 401) throw new YouTubeError(409, 'YouTube 권한이 만료되거나 철회되었습니다. 다시 연결해 주세요.');
      if (result.status === 404 || reason === 'youtubeSignupRequired') throw new YouTubeError(404, 'YouTube 채널 또는 자료를 찾을 수 없습니다.');
      throw new YouTubeError(503, 'YouTube 자료를 조회할 수 없습니다.');
    }
    return result.json();
  }
  const redirect = (status: string) => new Response(null, { status: 303, headers: { Location: `${config?.appUrl ?? ''}/learn?youtube=${status}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Set-Cookie': `youtube_oauth=; Path=/api/youtube/callback; HttpOnly; SameSite=Lax; Max-Age=0${config?.appUrl.startsWith('https:') ? '; Secure' : ''}` } });
  return {
    async STATUS(request: Request) {
      try {
        if (!config) return json({ configured: false, connected: false });
        const userId = await authenticate(request), row = await store<Stored | null>({ action: 'get', userId });
        if (!row) return json({ configured: true, connected: false });
        try {
          const body = await data(await access(userId), 'channels', { part: 'snippet', mine: 'true', maxResults: '1' });
          const channel = body.items?.[0];
          return json({ configured: true, connected: true, ...(channel ? { channel: { id: channel.id, title: channel.snippet?.title ?? 'YouTube', thumbnail: channel.snippet?.thumbnails?.default?.url } } : { error: '이 계정에는 YouTube 채널이 없습니다.' }) });
        } catch (error) { return json({ configured: true, connected: !(error instanceof YouTubeError && error.status === 409), error: error instanceof YouTubeError ? error.message : '연결 상태를 확인할 수 없습니다.' }); }
      } catch (error) { return failure(error); }
    },
    async CONNECT(request: Request) {
      try {
        const c = configured(), userId = await authenticate(request), state = randomBytes(32).toString('base64url'), binding = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
        await store({ action: 'begin', userId, generation: randomUUID(), stateHash: hash(state), bindingHash: hash(binding), verifier: seal(verifier, c, userId) });
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({ client_id: c.clientId, redirect_uri: `${c.appUrl}/api/youtube/callback`, response_type: 'code', scope, state, code_challenge: hash(verifier), code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString();
        const response = json({ url: url.toString() });
        response.headers.set('Set-Cookie', `youtube_oauth=${binding}; Path=/api/youtube/callback; HttpOnly; SameSite=Lax; Max-Age=600${c.appUrl.startsWith('https:') ? '; Secure' : ''}`);
        return response;
      } catch (error) { return failure(error); }
    },
    async CALLBACK(request: Request) {
      try {
        const c = configured(), params = new URL(request.url).searchParams;
        const state = params.get('state'), binding = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('youtube_oauth='))?.slice(14);
        if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !binding || !/^[A-Za-z0-9_-]{43}$/.test(binding)) return redirect('failed');
        const row = await store<Stored | null>({ action: 'consume', stateHash: hash(state), bindingHash: hash(binding) });
        if (!row) return redirect('failed');
        if (params.has('error')) return redirect(params.get('error') === 'access_denied' ? 'denied' : 'failed');
        const code = params.get('code'); if (!code || code.length > 4096) return redirect('failed');
        const tokens = await token({ grant_type: 'authorization_code', code, redirect_uri: `${c.appUrl}/api/youtube/callback`, code_verifier: unseal<string>(row.verifier, c, row.user_id) });
        const saved = await store<boolean>({ action: 'commit', userId: row.user_id, generation: row.generation, tokens: seal(tokens, c, row.user_id) });
        return redirect(saved ? 'connected' : 'failed');
      } catch { return redirect('failed'); }
    },
    async DISCONNECT(request: Request) {
      try {
        const c = configured(), userId = await authenticate(request);
        // Delete first: an in-flight refresh/callback can never recreate this row.
        const row = await store<Stored | null>({ action: 'disconnect', userId }); let revoked = !row?.tokens;
        if (row?.tokens) { try { const tokens = unseal<Tokens>(row.tokens, c, userId); revoked = (await call('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tokens.refresh || tokens.access }) })).ok; } catch { revoked = false; } }
        return json({ disconnected: true, revoked });
      } catch (error) { return failure(error); }
    },
    async LIBRARY(request: Request) {
      try {
        const userId = await authenticate(request), params = new URL(request.url).searchParams, kind = params.get('kind'), pageToken = params.get('pageToken') ?? '';
        for (const key of params.keys()) if (!['kind', 'pageToken', 'playlistId', 'channelId'].includes(key) || params.getAll(key).length !== 1) throw new YouTubeError(400, '잘못된 조회 요청입니다.');
        if ((params.has('playlistId') && params.has('channelId')) || (kind !== 'videos' && (params.has('playlistId') || params.has('channelId')))) throw new YouTubeError(400, '잘못된 조회 요청입니다.');
        if (pageToken.length > 2048 || !['playlists', 'subscriptions', 'videos'].includes(kind ?? '')) throw new YouTubeError(400, '잘못된 조회 요청입니다.');
        const id = params.get('playlistId') || params.get('channelId');
        if (kind === 'videos' && (!id || !/^[A-Za-z0-9_-]{1,150}$/.test(id))) throw new YouTubeError(400, '재생목록 또는 채널을 선택해 주세요.');
        const accessToken = await access(userId);
        let resource = kind!, parameters: Record<string, string> = { part: 'snippet', maxResults: '50', ...(pageToken ? { pageToken } : {}) };
        if (kind === 'videos') {
          let playlistId = params.get('playlistId');
          if (!playlistId) { const channel = await data(accessToken, 'channels', { part: 'contentDetails', id: id! }); playlistId = channel.items?.[0]?.contentDetails?.relatedPlaylists?.uploads; }
          if (!playlistId) throw new YouTubeError(404, '채널의 업로드 목록이 없습니다.');
          resource = 'playlistItems'; parameters = { ...parameters, playlistId };
        } else parameters.mine = 'true';
        const body = await data(accessToken, resource, parameters), items: Item[] = [];
        for (const entry of (Array.isArray(body.items) ? body.items.slice(0, 50) : [])) {
          const itemId = kind === 'videos' ? entry.snippet?.resourceId?.videoId : kind === 'subscriptions' ? entry.snippet?.resourceId?.channelId : entry.id;
          if (typeof itemId === 'string' && (kind !== 'videos' || /^[A-Za-z0-9_-]{11}$/.test(itemId))) items.push({ id: itemId, title: String(entry.snippet?.title ?? itemId).slice(0, 500), kind: kind === 'videos' ? 'video' : kind === 'subscriptions' ? 'channel' : 'playlist' });
        }
        return json({ items, ...(typeof body.nextPageToken === 'string' && body.nextPageToken.length <= 2048 ? { nextPageToken: body.nextPageToken } : {}) });
      } catch (error) { return failure(error); }
    },
  };
}
