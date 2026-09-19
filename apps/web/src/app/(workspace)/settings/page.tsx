import { YouTubeConnection } from '@/components/youtube-connection';
import { LearningGoalForm } from '@/components/learning-goal-form';
import { AvailabilityForm } from '@/components/availability-form';
import { NotificationForm } from '@/components/notification-form';
import { AccountControls } from '@/components/account-controls';

export default async function Page({ searchParams }: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">설정</h1>
      </header>
      <section id="availability" aria-labelledby="availability-title" className="scroll-mt-20 space-y-3">
        <h2 id="availability-title" className="font-semibold">요일별 학습 가능 시간</h2>
        <AvailabilityForm {...(typeof returnTo === 'string' ? { returnTo } : {})} />
      </section>
      <section aria-labelledby="learning-goal-title" className="space-y-3">
        <h2 id="learning-goal-title" className="font-semibold">하루 영어 학습 목표</h2>
        <LearningGoalForm />
      </section>
      <section aria-labelledby="notifications-title" className="space-y-3">
        <h2 id="notifications-title" className="font-semibold">알림</h2>
        <NotificationForm />
      </section>
      <section aria-labelledby="accounts-title" className="space-y-3">
        <h2 id="accounts-title" className="font-semibold">연결된 계정</h2>
        <YouTubeConnection />
      </section>
      <section aria-labelledby="account-title" className="space-y-3">
        <h2 id="account-title" className="font-semibold">계정</h2>
        <div className="rounded-xl border border-border bg-card p-5"><AccountControls /></div>
      </section>
    </div>
  );
}
