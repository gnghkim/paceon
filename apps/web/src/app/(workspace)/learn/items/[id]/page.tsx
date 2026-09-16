import { Suspense } from 'react';
import { LearningRoom } from '@/components/learning-room';
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<p role="status">학습실을 불러오는 중…</p>}>
      <LearningRoom key={id} id={id} />
    </Suspense>
  );
}
