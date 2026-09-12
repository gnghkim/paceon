import { schedulerContract } from '@paceon/scheduler';
import Link from 'next/link';

const steps = [
  ['01', '배울 것을 모으고', '읽고 싶은 책과 학습자료를 한곳에.'],
  ['02', '나에게 맞게 나누고', '목표와 여유 시간에 맞춘 하루 분량.'],
  ['03', '내 속도로 이어가요', '실제 진도를 반영해 다시 맞추는 계획.'],
] as const;

export default function Home() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-6 sm:px-12">
      <header className="flex items-center justify-between border-b border-border py-7">
        <Link href="/" aria-label="PaceOn 홈" className="text-2xl font-bold tracking-tight text-primary">PaceOn<span aria-hidden="true">.</span></Link>
        <span className="rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground">준비 중</span>
      </header>
      <main id="main" className="flex flex-1 flex-col justify-center py-16 sm:py-24">
        <p className="mb-6 text-sm font-medium tracking-wide text-primary">Your learning, at your pace.</p>
        <h1 className="max-w-3xl text-4xl leading-tight font-semibold tracking-tight break-keep sm:text-6xl sm:leading-tight">꾸준함에도,<br />나만의 속도가 있으니까.</h1>
        <p className="mt-7 max-w-xl text-base leading-8 break-keep text-muted-foreground sm:text-lg">내 속도에 맞춰 계속 다시 짜주는 학습 계획.<br className="hidden sm:block" /> PaceOn과 함께할 새로운 학습 공간을 준비하고 있어요.</p>
        <ol className="mt-14 grid gap-8 border-t border-border pt-8 sm:mt-20 sm:grid-cols-3 sm:gap-10">
          {steps.map(([number, title, description]) => (
            <li key={number}>
              <span className="text-xs font-semibold text-primary" aria-hidden="true">{number}</span>
              <h2 className="mt-3 text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 break-keep text-muted-foreground">{description}</p>
            </li>
          ))}
        </ol>
      </main>
      <footer className="border-t border-border py-6 text-xs text-muted-foreground">
        <p>PaceOn · 작은 진도가 쌓이는 곳</p>
        {/* Evaluated by the server to verify the workspace import, without suggesting live scheduling. */}
        <span hidden data-scheduler-stage={schedulerContract.implementation} />
      </footer>
    </div>
  );
}
