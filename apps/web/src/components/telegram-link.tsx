'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Send } from 'lucide-react';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';

type Status =
  | { linked: false; botUsername: string | null }
  | { linked: true; botUsername: string | null; linkedAt: string; level: string; voiceReplies: boolean; reviewAt: string };
type Issued = { code: string; expiresAt: string; botUsername: string | null; deepLink: string | null };

const LEVELS: Record<string, string> = { BEGINNER: '초급', INTERMEDIATE: '중급', ADVANCED: '고급' };
const time = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const day = (iso: string) =>
  new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));

/**
 * 텔레그램 튜터 연결. 코드를 받아 봇에 보내면 이어진다. 코드를 띄워 둔 동안은
 * 몇 초마다 상태를 다시 보고, 연결되면 코드를 치운다.
 */
export function TelegramLink() {
  const { apiFetch } = useAuth();
  const [status, setStatus] = useState<Status>();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const response = await apiFetch('/api/telegram/link', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '연결 상태를 확인하지 못했어요.');
    setStatus(body as Status);
    return body as Status;
  }, [apiFetch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refresh().catch((error: unknown) => setMessage(error instanceof Error ? error.message : '연결 상태를 확인하지 못했어요.'));
    }, 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  // 코드를 보낸 뒤 이 화면으로 돌아오면 바로 연결된 상태가 보이게 한다.
  useEffect(() => {
    if (!issued) return;
    timer.current = setInterval(() => {
      if (Date.now() > Date.parse(issued.expiresAt)) {
        setIssued(null);
        setMessage('코드가 만료됐어요. 새 코드를 받아 주세요.');
        return;
      }
      void refresh().then(next => {
        if (next.linked) {
          setIssued(null);
          setMessage('텔레그램과 연결했어요.');
        }
      }).catch(() => {});
    }, 4000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [issued, refresh]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '요청을 처리하지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  const issue = () => run(async () => {
    const response = await apiFetch('/api/telegram/link', { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '연결 코드를 만들지 못했어요.');
    setIssued(body as Issued);
  });

  const unlink = () => run(async () => {
    const response = await apiFetch('/api/telegram/link', { method: 'DELETE' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? '연결을 해제하지 못했어요.');
    setConfirming(false);
    await refresh();
    setMessage('연결을 해제했어요. 지금까지의 대화와 복습 카드는 그대로 남아 있어요.');
  });

  const bot = status?.botUsername;
  return (
    <div id="telegram" className="scroll-mt-20 space-y-3 rounded-xl border border-border bg-card p-5" aria-label="텔레그램 튜터 연결">
      <h3 className="flex items-center gap-2 font-semibold">
        <Send size={16} aria-hidden="true" />
        텔레그램 튜터
      </h3>
      <p className="text-sm text-muted-foreground">
        텔레그램에서 영어로 말을 걸면 튜터가 대화를 이어 가며 실수를 고쳐 줘요. 고친 실수는 복습 카드가 되어
        여기 복습과 텔레그램 퀴즈에 함께 나와요.
      </p>
      {!status && !message && <p role="status" className="text-sm">연결 상태 확인 중…</p>}

      {status?.linked && (
        <div className="space-y-3">
          <p className="text-sm">
            <span className="font-medium">연결됨</span> · {day(status.linkedAt)}부터
            <span className="text-muted-foreground">
              {' '}· 수준 {LEVELS[status.level] ?? status.level} · 아침 복습 {status.reviewAt}
              {status.voiceReplies ? ' · 음성 답장' : ''}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            수준, 음성 답장, 아침 복습 시각은 텔레그램에서 /level, /voice_on, /set_review 로 바꿔요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/learn/telegram">대화 보기 <ArrowRight size={15} aria-hidden="true" /></Link>
            </Button>
            {bot && (
              <Button asChild variant="outline">
                <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">텔레그램 열기</a>
              </Button>
            )}
            {confirming ? (
              <>
                <Button variant="outline" disabled={busy} onClick={() => void unlink()}>
                  {busy ? '해제하는 중…' : '해제하기'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>취소</Button>
              </>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>연결 해제</Button>
            )}
          </div>
        </div>
      )}

      {status && !status.linked && (
        issued ? (
          <div className="space-y-3 rounded-lg bg-accent/50 p-4">
            <p className="text-sm">아래 코드를 {time(issued.expiresAt)}까지 봇에 보내 주세요. 한 번만 쓸 수 있어요.</p>
            <p className="text-2xl font-semibold tracking-[0.2em]" aria-label={`연결 코드 ${issued.code.split('').join(' ')}`}>
              {issued.code}
            </p>
            <div className="flex flex-wrap gap-2">
              {issued.deepLink && (
                <Button asChild>
                  <a href={issued.deepLink} target="_blank" rel="noreferrer">텔레그램에서 바로 연결</a>
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => void issue()}>새 코드 받기</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {bot ? <>직접 보내려면 텔레그램에서 @{bot}에게 </> : <>텔레그램 튜터 봇에게 </>}
              <code>/link {issued.code}</code> 를 보내세요. 연결되면 이 화면이 저절로 바뀌어요.
            </p>
          </div>
        ) : (
          <Button disabled={busy} onClick={() => void issue()}>
            {busy ? '코드를 만드는 중…' : '연결 코드 받기'}
          </Button>
        )
      )}

      {message && <p className="text-sm" role="status">{message}</p>}
    </div>
  );
}
