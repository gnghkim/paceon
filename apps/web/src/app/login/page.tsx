'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, BookOpen, Check, ChevronDown } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { LoginLanding } from '@/components/login-landing';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSupabaseBrowser } from '@/lib/supabase-browser';
import { resolveLoginEmail } from '@/lib/login-identifier';

export default function LoginPage() {
  const { session, loading, configured, error: authError } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const emailField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!loading && session) router.replace('/today');
  }, [loading, session, router]);

  // 움직임을 줄이도록 설정한 사람에게는 부드러운 스크롤도 쓰지 않는다.
  const scrollBehavior = (): ScrollBehavior =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

  /** 소개를 다 읽고 누른 단추. 폼으로 돌아가 바로 입력할 수 있게 한다. */
  function startFrom(next: 'login' | 'signup') {
    setMode(next);
    setError(null);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    // 스크롤이 끝나기 전에 초점을 옮기면 브라우저가 그 자리로 건너뛴다.
    emailField.current?.focus({ preventScroll: true });
  }

  function showAbout() {
    document.getElementById('about')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !configured) return;
    setPending(true);
    setError(null);
    setMessage(null);
    const fields = new FormData(event.currentTarget);
    const identifier = String(fields.get('email') ?? '').trim();
    const email = mode === 'login'
      ? resolveLoginEmail(identifier, process.env.NEXT_PUBLIC_SUPABASE_URL)
      : identifier;
    const password = String(fields.get('password') ?? '');
    try {
      const client = getSupabaseBrowser();
      const result =
        mode === 'login'
          ? await client.auth.signInWithPassword({ email, password })
          : await client.auth.signUp({
              email,
              password,
              options: { emailRedirectTo: `${window.location.origin}/login` },
            });
      if (result.error) {
        const code = result.error.code;
        if (code === 'invalid_credentials')
          setError('이메일·아이디 또는 비밀번호를 확인해 주세요.');
        else if (code === 'email_not_confirmed')
          setError('가입 확인 메일의 링크를 누른 뒤 로그인해 주세요.');
        else if (code === 'weak_password')
          setError('비밀번호가 너무 약합니다. 더 긴 비밀번호를 사용해 주세요.');
        else if (
          code === 'over_request_rate_limit' ||
          code === 'over_email_send_rate_limit'
        )
          setError('요청이 많습니다. 잠시 후 다시 시도해 주세요.');
        else
          setError(
            mode === 'login'
              ? '로그인하지 못했습니다. 입력 내용과 연결 상태를 확인해 주세요.'
              : '가입하지 못했습니다. 입력 내용을 확인하고 다시 시도해 주세요.',
          );
        return;
      }
      if (result.data.session) router.replace('/today');
      else
        setMessage(
          '가입 확인 메일을 보냈습니다. 메일의 링크를 눌러 가입을 완료해 주세요.',
        );
    } catch {
      setError('연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      {/* 첫 화면은 그대로 로그인이다. 매일 여는 사람이 소개를 지나쳐야 하면 안 된다. */}
      <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-primary-soft p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-2.5 text-xl font-bold">
          <BookOpen className="text-primary" aria-hidden="true" />
          PaceOn
        </div>
        <div className="max-w-lg">
          <p className="mb-5 text-sm font-semibold tracking-wide text-primary">
            LEARN AT YOUR PACE
          </p>
          <h1 className="text-4xl leading-tight font-bold tracking-tight xl:text-5xl">
            계획은 가볍게,
            <br />
            배움은 꾸준하게.
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-muted-foreground">
            읽고 싶은 책부터 끝내고 싶은 교재까지.
            <br />
            오늘 할 만큼 나누고, 나만의 속도로 나아가세요.
          </p>
          <div className="mt-10 space-y-4 text-sm">
            {[
              '오늘 집중할 학습을 한눈에',
              '목표에 맞춘 나만의 학습 계획',
              '쌓여가는 진도를 차분하게 확인',
            ].map((text) => (
              <p key={text} className="flex items-center gap-3">
                <Check size={17} className="text-primary" aria-hidden="true" />
                {text}
              </p>
            ))}
          </div>
        </div>
        <div className="flex items-end justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            조금씩 나아가는 당신의 학습 파트너
          </p>
          <button
            type="button"
            onClick={showAbout}
            className="flex shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:text-primary"
          >
            자세히 알아보기
            <ChevronDown size={18} className="motion-safe:animate-bounce" aria-hidden="true" />
          </button>
        </div>
      </section>
      <section className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-12 flex items-center gap-2 text-xl font-bold lg:hidden">
            <BookOpen className="text-primary" aria-hidden="true" />
            PaceOn
          </div>
          <p className="mb-2 text-sm text-primary">
            {mode === 'login' ? '다시 만나 반가워요' : '나만의 학습을 시작해요'}
          </p>
          <h2 className="text-3xl font-bold tracking-tight">
            {mode === 'login'
              ? '오늘의 배움을 이어가세요'
              : 'PaceOn에 가입하기'}
          </h2>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {mode === 'login'
              ? '로그인하고 오늘의 학습 계획을 확인하세요.'
              : '이메일로 가입하고 첫 학습 자료를 추가해 보세요.'}
          </p>
          {!configured && (
            <p
              role="status"
              className="mt-6 rounded-lg bg-warning-soft p-4 text-sm leading-6"
            >
              로그인 서비스를 준비 중입니다. 잠시 후 다시 방문해 주세요.
            </p>
          )}
          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="text-sm font-medium">
                {mode === 'login' ? '이메일 또는 아이디' : '이메일'}
              </label>
              <Input
                id="email"
                ref={emailField}
                name="email"
                type={mode === 'login' ? 'text' : 'email'}
                autoComplete={mode === 'login' ? 'username' : 'email'}
                placeholder={mode === 'login' ? '이메일 또는 아이디' : 'you@example.com'}
                required
                maxLength={254}
                disabled={pending || !configured}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-medium">
                비밀번호
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === 'login' ? 'current-password' : 'new-password'
                }
                placeholder={
                  mode === 'signup'
                    ? '6자 이상 입력해 주세요'
                    : '비밀번호를 입력해 주세요'
                }
                minLength={mode === 'signup' ? 6 : 1}
                required
                disabled={pending || !configured}
              />
            </div>
            {(error || authError) && (
              <p
                role="alert"
                className="rounded-lg bg-danger-soft p-3 text-sm leading-6 text-danger"
              >
                {error ?? authError}
              </p>
            )}
            {message && (
              <p
                role="status"
                className="rounded-lg bg-success-soft p-3 text-sm leading-6 text-success"
              >
                {message}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending || loading || !configured}
            >
              {pending
                ? '잠시만 기다려 주세요…'
                : mode === 'login'
                  ? '로그인'
                  : '가입하기'}
              <ArrowRight aria-hidden="true" />
            </Button>
          </form>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-1 text-sm">
            <span className="text-muted-foreground">
              {mode === 'login'
                ? '아직 계정이 없으신가요?'
                : '이미 계정이 있으신가요?'}
            </span>
            <Button
              variant="ghost"
              className="text-primary"
              disabled={pending}
              onClick={() => {
                setMode(mode === 'login' ? 'signup' : 'login');
                setError(null);
                setMessage(null);
              }}
            >
              {mode === 'login' ? '가입하기' : '로그인'}
            </Button>
          </div>
          {/* 좁은 화면에는 왼쪽 소개가 없다. 처음 온 사람이 아래에 더 있다는 것을 알 수 있게 한다. */}
          <button
            type="button"
            onClick={showAbout}
            className="mx-auto mt-10 flex flex-col items-center gap-1 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:text-primary lg:hidden"
          >
            PaceOn이 처음이라면
            <ChevronDown size={18} className="motion-safe:animate-bounce" aria-hidden="true" />
          </button>
        </div>
      </section>
      </div>
      <LoginLanding onStart={startFrom} />
    </main>
  );
}
