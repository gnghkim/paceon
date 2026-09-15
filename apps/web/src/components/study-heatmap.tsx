'use client';
import { useEffect, useRef } from 'react';
import type { HeatmapDay } from '@/lib/study-heatmap';

const LEVEL_CLASS = ['bg-muted', 'bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'] as const;
const WEEKDAY_LABEL = ['월', '', '수', '', '금', '', ''] as const;

function mondayIndex(date: string): number {
  // 0=월..6=일. 날짜 문자열을 UTC 자정으로 해석해 요일만 뽑아낸다(시간대 변환 없음).
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function StudyHeatmap({ days, weeks, onSelectDay }: {
  days: readonly HeatmapDay[];
  weeks?: number;
  onSelectDay?: (day: HeatmapDay) => void;
}) {
  const visible = weeks ? days.slice(-weeks * 7) : days;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [visible.length]);
  if (!visible.length) return null;
  const leadingBlanks = mondayIndex(visible[0]!.date);
  const cells: (HeatmapDay | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...visible];
  const weekCount = Math.ceil(cells.length / 7);
  const columns: (HeatmapDay | null)[][] = Array.from({ length: weekCount }, (_, week) => cells.slice(week * 7, week * 7 + 7));
  const monthLabel = (column: (HeatmapDay | null)[]) => {
    const firstOfMonth = column.find((day): day is HeatmapDay => day !== null && Number(day.date.slice(8, 10)) <= 7);
    return firstOfMonth ? `${Number(firstOfMonth.date.slice(5, 7))}월` : '';
  };

  return (
    <div className="space-y-2">
      <div ref={scrollRef} className="flex gap-1 overflow-x-auto pb-1">
        <div className="grid shrink-0 grid-rows-7 gap-1 pt-4 text-[10px] text-muted-foreground">
          {WEEKDAY_LABEL.map((label, row) => <span key={row} className="flex h-3 items-center">{label}</span>)}
        </div>
        <div className="grid grid-flow-col gap-1">
          {columns.map((column, weekIndex) => (
            <div key={weekIndex} className="space-y-1">
              <div className="h-3 text-[10px] text-muted-foreground">{monthLabel(column)}</div>
              <div className="grid grid-rows-7 gap-1">
                {column.map((cell, row) =>
                  cell ? (
                    onSelectDay ? (
                      <button
                        key={cell.date}
                        type="button"
                        onClick={() => onSelectDay(cell)}
                        aria-label={`${cell.date} · ${cell.minutes}분`}
                        title={`${cell.date} · ${cell.minutes}분`}
                        className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[cell.level]}`}
                      />
                    ) : (
                      <span
                        key={cell.date}
                        aria-label={`${cell.date} · ${cell.minutes}분`}
                        title={`${cell.date} · ${cell.minutes}분`}
                        className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[cell.level]}`}
                      />
                    )
                  ) : (
                    <span key={`blank-${weekIndex}-${row}`} className="h-3 w-3" aria-hidden="true" />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>적음</span>
        {LEVEL_CLASS.map((cls, level) => <span key={level} className={`h-3 w-3 rounded-sm ${cls}`} aria-hidden="true" />)}
        <span>많음</span>
        <span>· 0 / &lt;15 / 15–29 / 30–59 / 60분+</span>
      </div>
    </div>
  );
}
