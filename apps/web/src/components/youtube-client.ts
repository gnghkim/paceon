import { getSupabaseBrowser } from '@/lib/supabase-browser';

export type YouTubeStatus = { configured: boolean; connected: boolean; channel?: { id: string; title: string; thumbnail?: string }; error?: string };

export async function youtubeApi<T>(path: string, body?: unknown): Promise<T> {
  const { data } = await getSupabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('로그인이 필요합니다.');
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
  return result as T;
}
