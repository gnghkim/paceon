'use client';
import { cn } from '@/lib/utils';
import type { LearningRoomTab } from './learning-room-view';

export function LearningRoomTabs({ tabs, current, onSelect }: {
  tabs: readonly { id: LearningRoomTab; label: string }[];
  current: LearningRoomTab;
  onSelect: (tab: LearningRoomTab) => void;
}) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="학습 활동" className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(tab.id)}
            className={cn(
              'min-h-11 border-b-2 px-4 py-3 text-sm font-medium',
              active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
