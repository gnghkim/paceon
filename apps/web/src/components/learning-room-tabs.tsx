'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import type { LearningRoomTab } from './learning-room-view';

export function LearningRoomTabs({ tabs, current, blocked = false, onSelect }: {
  tabs: readonly { id: LearningRoomTab; label: string }[];
  current: LearningRoomTab;
  blocked?: boolean;
  onSelect: (tab: LearningRoomTab) => void;
}) {
  const [pending, setPending] = useState<LearningRoomTab | null>(null);
  if (tabs.length < 2) return null;
  const choose = (next: LearningRoomTab) => {
    if (next === current) return;
    if (blocked) { setPending(next); return; }
    onSelect(next);
  };
  return (
    <div className="space-y-3">
      <nav aria-label="학습 활동" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((tab) => {
          const active = tab.id === current;
          return (
            <button
              key={tab.id}
              type="button"
              aria-pressed={active}
              onClick={() => choose(tab.id)}
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
      {pending && (
        <div role="alert" className="space-y-3 rounded-xl bg-warning-soft p-4 text-sm">
          <p>녹음 중이에요. 다른 활동으로 옮기면 녹음이 멈춰요.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { const next = pending; setPending(null); onSelect(next); }}>녹음을 멈추고 이동</Button>
            <Button variant="outline" onClick={() => setPending(null)}>계속 녹음</Button>
          </div>
        </div>
      )}
    </div>
  );
}
