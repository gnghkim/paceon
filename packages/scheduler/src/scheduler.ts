import { dateFromDay, dayNumber, isoWeekday, validateTimezone } from './dates.ts';
import type { BatchInput, BatchResult, BookInput, ConflictCode, ExistingSession, PlannedSession, ReplanInput, ScheduleResult, ScheduleSuccess } from './types.ts';

class PlanningError extends Error {
  readonly code: ConflictCode;
  constructor(code: ConflictCode, detail: string) { super(detail); this.code = code; }
}
function fail(code: ConflictCode, detail: string): never { throw new PlanningError(code, detail); }
function integer(value: number, min: number, max: number): boolean { return Number.isSafeInteger(value) && value >= min && value <= max; }
function add(map: Map<number, number>, day: number, amount: number) { map.set(day, (map.get(day) ?? 0) + amount); }

/** The caller supplies the continuous progress projection; this function never reads a DB or clock. */
export function scheduleBook(input: BookInput): ScheduleResult {
  return calculate(input, [], [], undefined);
}

export function replanBook(input: ReplanInput): ScheduleResult {
  const preserved: ExistingSession[] = [];
  const replaced: string[] = [];
  try {
    const today = dayNumber(input.asOfDate);
    for (const item of input.existingSessions) {
      if (dayNumber(item.studyDate) <= today || item.isLocked || item.status === 'COMPLETED' || item.status === 'IN_PROGRESS') preserved.push(item);
      else replaced.push(item.id);
    }
    const start = Math.max(dayNumber(input.startDate), today + 1);
    return calculate({ ...input, startDate: dateFromDay(start) }, preserved, replaced, input);
  } catch (error) {
    return { status: 'conflict', preservedSessions: [...input.existingSessions], conflicts: [{ code: 'INVALID_INPUT', detail: error instanceof Error ? error.message : 'Invalid input' }] };
  }
}

function calculate(input: BookInput, preserved: readonly ExistingSession[], replaced: readonly string[], replan: ReplanInput | undefined): ScheduleResult {
  try {
    const start = dayNumber(input.startDate);
    validateTimezone(input.timezone);
    const maxDays = input.maxDays ?? 3660;
    const increase = input.balancedIncreaseRatio ?? 0.2;
    const dailyPages = input.dailyPages ?? (input.mode === 'DEADLINE' ? 1 : Number.NaN);
    if (!integer(input.totalPages, 1, 10_000_000) || !integer(input.completedThroughPage, 0, input.totalPages)
      || !integer(dailyPages, 1, 10_000_000) || !Number.isFinite(input.minutesPerPage) || input.minutesPerPage <= 0
      || !integer(maxDays, 1, 3660) || !Number.isFinite(increase) || increase < 0 || increase > 1
      || !['DEADLINE', 'PACE', 'BALANCED'].includes(input.mode)) fail('INVALID_INPUT', 'Invalid book or policy values');
    const end = Math.min(start + maxDays - 1, dayNumber('9999-12-31'));
    const target = input.targetDate === undefined ? undefined : dayNumber(input.targetDate);
    if (input.mode === 'DEADLINE' && target === undefined) fail('INVALID_INPUT', 'Deadline mode requires a target date');
    const weekdays = new Map<number, number>();
    for (const rule of input.availability) {
      if (!integer(rule.isoWeekday, 1, 7) || !Number.isFinite(rule.availableMinutes) || rule.availableMinutes < 0 || rule.availableMinutes > 1440 || weekdays.has(rule.isoWeekday)) fail('INVALID_INPUT', 'Invalid or duplicate availability');
      weekdays.set(rule.isoWeekday, rule.availableMinutes);
    }
    const usedMinutes = new Map<number, number>();
    const usedPages = new Map<number, number>();
    for (const reservation of input.reservedMinutes ?? []) {
      const day = dayNumber(reservation.studyDate);
      if (!Number.isFinite(reservation.minutes) || reservation.minutes < 0 || reservation.minutes > 1440) fail('INVALID_INPUT', 'Invalid reservation');
      add(usedMinutes, day, reservation.minutes);
    }
    const ids = new Set<string>();
    for (const item of replan?.existingSessions ?? []) {
      dayNumber(item.studyDate);
      if (!item.id || ids.has(item.id) || !integer(item.startPage, 1, input.totalPages) || !integer(item.endPage, item.startPage, input.totalPages)
        || !Number.isFinite(item.estimatedMinutes) || item.estimatedMinutes <= 0 || typeof item.isLocked !== 'boolean'
        || !['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED'].includes(item.status)) fail('INVALID_INPUT', 'Invalid existing session');
      ids.add(item.id);
    }
    const future = preserved.filter(item => replan !== undefined && item.studyDate > replan.asOfDate);
    const pins = future.filter(item => item.status !== 'COMPLETED')
      .slice().sort((a, b) => a.startPage - b.startPage || a.studyDate.localeCompare(b.studyDate));
    for (const item of future) {
      if (item.status === 'COMPLETED' && item.endPage > input.completedThroughPage) fail('PROGRESS_MISMATCH', 'Future completed session is outside the completed projection');
    }
    let previousPage = input.completedThroughPage;
    let previousDate = start;
    for (const pin of pins) {
      const date = dayNumber(pin.studyDate);
      if (pin.startPage <= previousPage) fail('PINNED_OVERLAP', `Pinned session ${pin.id} overlaps completed or reserved pages`);
      if (date < previousDate) fail('PINNED_ORDER', 'Pinned dates contradict page order');
      if (date > end) fail('HORIZON_EXCEEDED', 'Pinned session is beyond the planning horizon');
      if (input.mode === 'DEADLINE' && target !== undefined && date > target) fail('DEADLINE_CAPACITY', 'Pinned session is after the target');
      add(usedMinutes, date, pin.estimatedMinutes);
      add(usedPages, date, pin.endPage - pin.startPage + 1);
      if ((usedMinutes.get(date) ?? 0) > (weekdays.get(isoWeekday(date)) ?? 0) + 1e-9) fail('PINNED_CAPACITY', `Pinned time exceeds availability on ${pin.studyDate}`);
      previousPage = pin.endPage;
      previousDate = date;
    }
    const remaining = input.totalPages - input.completedThroughPage;
    if (remaining === 0) return completeResult(input, [], preserved, replaced, replan);
    if (target !== undefined && target < start) fail('TARGET_IN_PAST', 'Target precedes the first changeable day');
    if (![...weekdays.values()].some(minutes => minutes > 0)) fail('NO_AVAILABILITY', 'No learning time is available');
    if (input.mode === 'DEADLINE' && target !== undefined && target > end) fail('HORIZON_EXCEEDED', 'Target exceeds the supported horizon');
    for (const [date, minutes] of usedMinutes) {
      if (date >= start && date <= end && minutes > (weekdays.get(isoWeekday(date)) ?? 0) + 1e-9) fail('TIME_CAPACITY', `Reserved time exceeds the budget on ${dateFromDay(date)}`);
    }

    const sessions: PlannedSession[] = [];
    const balancedCap = Math.floor(dailyPages * (1 + increase) + 1e-10);
    const capacity = (day: number, pageLimit: number) => {
      const minutes = Math.max(0, (weekdays.get(isoWeekday(day)) ?? 0) - (usedMinutes.get(day) ?? 0));
      return Math.max(0, Math.min(input.totalPages, Math.floor(minutes / input.minutesPerPage + 1e-10), pageLimit - (usedPages.get(day) ?? 0)));
    };

    function allocate(first: number, last: number, firstDay: number, pinDay?: number) {
      if (first > last) return;
      const lastDay = Math.min(end, pinDay ?? end, input.mode === 'DEADLINE' ? target! : end);
      const hasDeadline = target !== undefined || pinDay !== undefined;
      const pageLimit = input.mode === 'DEADLINE' ? input.totalPages : input.mode === 'BALANCED' && hasDeadline ? balancedCap : dailyPages;
      const slots: { day: number; cap: number }[] = [];
      for (let day = firstDay; day <= lastDay; day++) {
        if ((weekdays.get(isoWeekday(day)) ?? 0) > 0) slots.push({ day, cap: capacity(day, pageLimit) });
      }
      let left = last - first + 1;
      let cursor = first;
      const deadline = Math.min(pinDay ?? end, target ?? end, lastDay);
      const targetSlots = slots.filter(slot => slot.day <= deadline && slot.cap > 0);
      const targetCapacity = targetSlots.reduce((sum, slot) => sum + slot.cap, 0);
      if (pinDay !== undefined && slots.reduce((sum,slot) => sum + slot.cap,0) < left) fail('PINNED_ORDER', 'Not enough capacity before the pinned range');
      if (input.mode === 'DEADLINE' && targetCapacity < left) fail('DEADLINE_CAPACITY', `Need ${left} pages, but only ${targetCapacity} fit before the target`);
      const goalPages = input.mode === 'BALANCED'
        ? target === undefined && pinDay === undefined ? dailyPages : Math.min(balancedCap, Math.max(dailyPages, Math.ceil(left / Math.max(1, targetSlots.length))))
        : dailyPages;
      let futureCapacity = targetCapacity;
      let futureDays = targetSlots.length;
      for (const slot of slots) {
        if (!left) break;
        if (slot.day <= deadline && slot.cap > 0) { futureCapacity -= slot.cap; futureDays--; }
        const already = usedPages.get(slot.day) ?? 0;
        let pages: number;
        if (input.mode === 'PACE') {
          pages = Math.min(left, Math.max(0, dailyPages - already));
          if (slot.cap < pages) fail('TIME_CAPACITY', `Preferred pace does not fit on ${dateFromDay(slot.day)}`);
        } else {
          const preferred = input.mode === 'DEADLINE' ? Math.ceil(left / Math.max(1, futureDays + (slot.cap > 0 ? 1 : 0))) : Math.max(0, goalPages - already);
          const required = slot.day <= deadline && targetCapacity >= last - first + 1 ? Math.max(0, left - futureCapacity) : 0;
          pages = Math.min(left, slot.cap, Math.max(preferred, required));
        }
        if (pages === 0) continue;
        const minutes = pages * input.minutesPerPage;
        sessions.push({ studyDate: dateFromDay(slot.day), startPage: cursor, endPage: cursor + pages - 1, pages, estimatedMinutes: minutes });
        add(usedMinutes, slot.day, minutes);
        add(usedPages, slot.day, pages);
        cursor += pages;
        left -= pages;
      }
      if (left) fail(pinDay === undefined ? 'HORIZON_EXCEEDED' : 'PINNED_ORDER', `${left} pages cannot fit within the planning window`);
    }

    let cursor = input.completedThroughPage + 1;
    let firstDay = start;
    for (const pin of pins) {
      const day = dayNumber(pin.studyDate);
      allocate(cursor, pin.startPage - 1, firstDay, day);
      cursor = pin.endPage + 1;
      firstDay = day;
    }
    allocate(cursor, input.totalPages, firstDay);
    sessions.sort((a,b) => a.studyDate.localeCompare(b.studyDate) || a.startPage - b.startPage);
    return completeResult(input, sessions, preserved, replaced, replan);
  } catch (error) {
    return { status: 'conflict', preservedSessions: [...preserved], conflicts: [{ code: error instanceof PlanningError ? error.code : 'INVALID_INPUT', detail: error instanceof Error ? error.message : 'Invalid input' }] };
  }
}

function completeResult(input: BookInput, sessions: readonly PlannedSession[], preserved: readonly ExistingSession[], replaced: readonly string[], replan: ReplanInput | undefined): ScheduleSuccess {
  const remaining = input.totalPages - input.completedThroughPage;
  const dates = [...sessions.map(item => item.studyDate), ...preserved.filter(item => item.studyDate >= input.startDate && item.status !== 'COMPLETED').map(item => item.studyDate)];
  const forecastDate = remaining === 0 ? null : dates.sort().at(-1) ?? null;
  const previousForecast = replan?.existingSessions.map(item => item.studyDate).sort().at(-1) ?? null;
  const reasons: ScheduleSuccess['reasons'][number][] = [
    { code: 'MODE_APPLIED', value: input.mode }, { code: 'REMAINING_PAGES', value: remaining },
    { code: 'PRESERVED_SESSIONS', value: preserved.length },
  ];
  if (replan && forecastDate !== previousForecast) reasons.push({ code: 'FORECAST_CHANGED', value: forecastDate, previousValue: previousForecast });
  if (input.targetDate && forecastDate && forecastDate > input.targetDate) reasons.push({ code: 'TARGET_EXTENDED', value: forecastDate, previousValue: input.targetDate });
  return { status: remaining === 0 ? 'completed' : 'ok', sessions, preservedSessions: [...preserved], replacedSessionIds: [...replaced], forecastDate, reasons };
}

/** Input order is explicit priority; a conflict never returns a partial batch for application. */
export function scheduleBooks(input: BatchInput): BatchResult {
  const reservations = [...(input.reservedMinutes ?? [])];
  const plans: { id: string; result: ScheduleSuccess }[] = [];
  const ids = new Set<string>();
  for (const book of input.books) {
    if (!book.id || ids.has(book.id)) return { status: 'conflict', bookId: book.id, conflicts: [{ code: 'INVALID_INPUT', detail: 'Book IDs must be unique and nonempty' }] };
    ids.add(book.id);
    const result = scheduleBook({ ...book.input, availability: input.availability, timezone: input.timezone, reservedMinutes: reservations });
    if (result.status === 'conflict') return { status: 'conflict', bookId: book.id, conflicts: result.conflicts };
    plans.push({ id: book.id, result });
    reservations.push(...result.sessions.map(item => ({ studyDate: item.studyDate, minutes: item.estimatedMinutes })));
  }
  return { status: 'ok', plans };
}
