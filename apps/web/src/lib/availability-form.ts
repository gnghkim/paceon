import type { AvailabilityRule } from '@paceon/shared';

export function availabilityFields(saved: readonly AvailabilityRule[]): Record<number, string> {
  return Object.fromEntries(Array.from({ length: 7 }, (_, index) => {
    const rule = saved.find(item => item.iso_weekday === index + 1);
    return [index + 1, rule ? String(rule.available_minutes) : ''];
  }));
}

/** Blank and zero mean rest; reject invalid values rather than silently dropping them. */
export function availabilityRules(minutes: Record<number, string>) {
  const rules: { isoWeekday: number; availableMinutes: number }[] = [];
  for (const [day, value] of Object.entries(minutes)) {
    if (!value.trim() || Number(value) === 0) continue;
    const availableMinutes = Number(value);
    if (!Number.isInteger(availableMinutes) || availableMinutes < 1 || availableMinutes > 1440) return null;
    rules.push({ isoWeekday: Number(day), availableMinutes });
  }
  return rules;
}

export function resourceReturnPath(value: string | undefined): string | null {
  return value && /^\/resources\/(?:materials\/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}
