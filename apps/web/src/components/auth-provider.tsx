'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  getSupabaseBrowser,
  isSupabaseConfigured,
} from '@/lib/supabase-browser';
import { allowSpeechDrafts, clearSpeechDrafts } from './speech-draft';

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  configured: boolean;
  error: string | null;
  signOut: () => Promise<void>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const sessionError = '로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const configured = isSupabaseConfigured();
  const previousOwner = useRef<string | null>(null);
  useEffect(() => {
    const owner = session?.user.id ?? null;
    if (previousOwner.current && previousOwner.current !== owner)
      void clearSpeechDrafts(previousOwner.current).catch(() => {});
    if (owner) allowSpeechDrafts(owner);
    previousOwner.current = owner;
  }, [session?.user.id]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    async function initialize() {
      try {
        if (!configured) return;
        const client = getSupabaseBrowser();
        const { data: listener } = client.auth.onAuthStateChange(
          (_event, nextSession) => {
            if (active) {
              setSession(nextSession);
              setError(null);
              setLoading(false);
            }
          },
        );
        unsubscribe = () => listener.subscription.unsubscribe();
        const { data, error: authError } = await client.auth.getSession();
        if (authError) throw authError;
        if (active) setSession(data.session);
      } catch {
        if (active) {
          setSession(null);
          setError(sessionError);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [configured]);

  const signOut = useCallback(async () => {
    try {
      const { error: authError } = await getSupabaseBrowser().auth.signOut({
        scope: 'local',
      });
      if (authError) throw authError;
      setSession(null);
      setError(null);
    } catch {
      throw new Error('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  }, []);

  const apiFetch = useCallback(async (path: string, init?: RequestInit) => {
    const url = new URL(path, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      !url.pathname.startsWith('/api/')
    ) {
      throw new Error('요청 주소가 올바르지 않습니다.');
    }
    let currentSession: Session | null;
    try {
      const { data, error: authError } =
        await getSupabaseBrowser().auth.getSession();
      if (authError) throw authError;
      currentSession = data.session;
    } catch {
      setSession(null);
      setError(sessionError);
      throw new Error(sessionError);
    }
    if (!currentSession) {
      setSession(null);
      throw new Error('로그인이 필요합니다. 다시 로그인해 주세요.');
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${currentSession.access_token}`);
    const response = await fetch(url, {
      ...init,
      headers,
      cache: 'no-store',
      redirect: 'error',
    });
    if (response.status === 401) {
      // A late response from the previous user must not sign out a new session.
      const { data } = await getSupabaseBrowser().auth.getSession();
      if (data.session?.access_token === currentSession.access_token) {
        setSession(null);
        setError(sessionError);
      }
      throw new Error(sessionError);
    }
    return response;
  }, []);

  const value = useMemo(
    () => ({ session, loading, configured, error, signOut, apiFetch }),
    [session, loading, configured, error, signOut, apiFetch],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider');
  return value;
}
