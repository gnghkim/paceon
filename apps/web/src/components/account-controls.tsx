'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';

/** The sidebar and settings share the same sign-out status and error behavior. */
export function AccountControls() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function leave() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await signOut();
      router.replace('/login');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '로그아웃하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <p className="break-all text-xs text-muted-foreground">{session?.user.email}</p>
      <Button variant="ghost" className="min-h-11 justify-start text-muted-foreground" disabled={busy} onClick={() => void leave()}>
        <LogOut aria-hidden="true" />
        {busy ? '로그아웃 중…' : '로그아웃'}
      </Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
