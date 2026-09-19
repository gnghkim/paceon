'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import {
  BookOpen,
  CalendarDays,
  ChartColumn,
  Plus,
  Settings,
  Sun,
  MessageSquare,
} from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  QuickRecordProvider,
  RecordButton,
} from './quick-record';
import { ReadingTimerProvider } from './reading-timer';
import { UnitRecordProvider } from './unit-record';
import { AccountControls } from './account-controls';
import { activeNavigation, pageTitle, primaryNavigation } from '@/lib/navigation';

const icons = { '/today': Sun, '/learn': MessageSquare, '/calendar': CalendarDays, '/resources': BookOpen, '/statistics': ChartColumn };
const navigation = primaryNavigation.map(item => ({ ...item, icon: icons[item.href] }));

export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return (
    <QuickRecordProvider key={session?.user.id ?? 'anonymous'}>
      <UnitRecordProvider>
        <AppShellContent>{children}</AppShellContent>
      </UnitRecordProvider>
    </QuickRecordProvider>
  );
}

function AppShellContent({ children }: { children: ReactNode }) {
  const { session, loading, configured, error } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (!loading && configured && !session && !error) router.replace('/login');
  }, [loading, configured, session, error, router]);

  if (!configured || error)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6">
        <span className="text-xl font-bold text-primary">PaceOn</span>
        <h1 className="text-2xl font-semibold">
          {configured ? '다시 로그인해 주세요' : '잠시 준비하고 있어요'}
        </h1>
        <p role="alert" className="text-sm leading-6 text-muted-foreground">
          {error ??
            '로그인 서비스를 준비 중입니다. 잠시 후 다시 방문해 주세요.'}
        </p>
        <Button asChild>
          <Link href="/login">로그인 화면으로</Link>
        </Button>
      </main>
    );

  if (loading || !session)
    return (
      <main
        className="mx-auto max-w-5xl space-y-6 px-6 py-20"
        role="status"
        aria-label="로그인 상태 확인 중"
      >
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <span className="sr-only">로그인 상태를 확인하고 있습니다.</span>
      </main>
    );

  const active = (href: string) => activeNavigation(pathname) === href;
  const title = pageTitle(pathname);

  return (
    <div className="min-h-dvh bg-background">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-surface p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        본문으로 건너뛰기
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-surface md:flex">
        <Link
          href="/today"
          className="flex h-16 items-center gap-2.5 px-6 text-xl font-bold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-white">
            <BookOpen size={18} aria-hidden="true" />
          </span>
          PaceOn
        </Link>
        <nav aria-label="주 메뉴" className="space-y-1 px-3 py-7">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={active(href) ? 'page' : undefined}
              className={cn(
                'flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-surface-subtle',
                active(href) && 'bg-primary-soft text-primary',
              )}
            >
              <Icon size={18} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="px-4">
          <Button asChild className="min-h-11 w-full">
            <Link href="/resources/add">
              <Plus aria-hidden="true" />
              자료 추가
            </Link>
          </Button>
        </div>
        <div className="mt-auto space-y-3 border-t border-border p-4">
          <Link href="/settings" aria-current={pathname === '/settings' ? 'page' : undefined}
            className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm', pathname === '/settings' ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-surface-subtle')}>
            <Settings size={18} aria-hidden="true" />설정
          </Link>
          <AccountControls />
        </div>
      </aside>
      <div className="md:pl-56">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-surface px-4 sm:px-8">
          <Link href="/today" className="font-bold text-primary md:hidden">
            PaceOn
          </Link>
          <p className="hidden text-sm font-medium md:block">{title}</p>
          <div className="flex items-center gap-2">
            <RecordButton className="min-h-11 px-3" />
            <Button asChild variant="ghost" size="icon" aria-label="설정" className={cn("size-11", pathname === "/settings" && "bg-primary-soft text-primary")}>
              <Link href="/settings" aria-current={pathname === '/settings' ? 'page' : undefined}>
                <Settings aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </header>
        <ReadingTimerProvider>
          <main
            key={session.user.id}
            id="main-content"
            className="mx-auto max-w-[1216px] px-4 pt-8 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-8 md:pb-12"
          >
            {children}
          </main>
        </ReadingTimerProvider>
      </div>
      <nav
        aria-label="모바일 주 메뉴"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}
            className={cn('flex min-h-16 flex-col items-center justify-center gap-1 border-t-2 border-transparent text-xs text-muted-foreground', active(href) && 'border-primary bg-primary-soft font-semibold text-primary')}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
