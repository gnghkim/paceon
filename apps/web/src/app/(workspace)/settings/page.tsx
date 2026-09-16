import { YouTubeConnection } from '@/components/youtube-connection';
import { LearningGoalForm } from '@/components/learning-goal-form';
import { AvailabilityForm } from '@/components/availability-form';
import { NotificationForm } from '@/components/notification-form';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold">설정</h1>
      </header>
      <section aria-labelledby="availability-title" className="space-y-3">
        <h2 id="availability-title" className="font-semibold">학습 시간</h2>
        <AvailabilityForm />
      </section>
      <section aria-labelledby="learning-goal-title" className="space-y-3">
        <h2 id="learning-goal-title" className="font-semibold">학습 목표</h2>
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
    </div>
  );
}
