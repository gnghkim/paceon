'use client';
import { useEffect, useRef } from 'react';
import { heatmapWeeks, type HeatmapDay } from '@/lib/study-heatmap';

const LEVEL_CLASS = ['bg-muted', 'bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'] as const;
const WEEKDAY_LABEL = ['월', '', '수', '', '금', '', ''] as const;

/** 기록된 분과 시간을 적지 않은 분량을 구분해 말한다. 추정값을 분으로 말하지 않는다. */
function dayLabel(day: HeatmapDay) {
  if (day.untimedPages > 0)
    return `${day.date} · ${day.minutes}분 · 시간 미입력 ${day.untimedPages}쪽`;
  return `${day.date} · ${day.minutes}분`;
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
  const columns = heatmapWeeks(visible);

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {/* Weekday labels stay outside the scroller so they remain visible at the "today" end. */}
        <div className="grid shrink-0 grid-rows-7 gap-1 pt-4 text-[10px] text-muted-foreground">
          {WEEKDAY_LABEL.map((label, row) => <span key={row} className="flex h-3 items-center">{label}</span>)}
        </div>
        <div ref={scrollRef} className="min-w-0 overflow-x-auto pb-1">
          <div className="grid w-max grid-flow-col gap-1">
          {columns.map((column, weekIndex) => (
            <div key={weekIndex} className="w-3 space-y-1">
              {/* The label overflows to the right so a wide month name never widens its week column. */}
              <div className="relative h-3 text-[10px] text-muted-foreground">
                <span className="absolute left-0 top-0 whitespace-nowrap leading-3">{column.label}</span>
              </div>
              <div className="grid grid-rows-7 gap-1">
                {column.cells.map((cell, row) =>
                  cell ? (
                    onSelectDay ? (
                      <button
                        key={cell.date}
                        type="button"
                        onClick={() => onSelectDay(cell)}
                        aria-label={dayLabel(cell)}
                        title={dayLabel(cell)}
                        className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[cell.level]}`}
                      />
                    ) : (
                      <span
                        key={cell.date}
                        aria-label={dayLabel(cell)}
                        title={dayLabel(cell)}
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
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>적음</span>
        {LEVEL_CLASS.map((cls, level) => <span key={level} className={`h-3 w-3 rounded-sm ${cls}`} aria-hidden="true" />)}
        <span>많음</span>
        <span>· 0 / &lt;15 / 15–29 / 30–59 / 60분+ · 시간 미입력 기록은 분량으로 추정</span>
      </div>
    </div>
  );
}
