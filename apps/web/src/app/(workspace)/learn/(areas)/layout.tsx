import type { ReactNode } from 'react';
import { LearningAreasShell } from '@/components/learning-areas-shell';

export default function Layout({ children }: { children: ReactNode }) {
  return <LearningAreasShell>{children}</LearningAreasShell>;
}
