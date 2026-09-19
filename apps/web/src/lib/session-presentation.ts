import type { Resource, ScheduleSession } from '@paceon/shared';

/** Shared calendar/card identity; missing resources must never imply a book route. */
export function describeSession(
  session: ScheduleSession,
  resource: Resource | undefined,
  unit?: { title: string; minutes: number | null },
) {
  if (!resource || resource.id !== session.resource_id)
    return { title: '자료 정보를 확인할 수 없어요', detail: '', href: null };
  const isUnit = resource.workload_unit === 'UNIT';
  const minutes = unit?.minutes ?? session.estimated_minutes;
  const detail = isUnit
    ? [unit?.title ?? resource.unit_label ?? '챕터', minutes != null ? `${minutes}분` : null].filter(Boolean).join(' · ')
    : session.start_page != null && session.end_page != null
      ? `${session.start_page}–${session.end_page}쪽`
      : '';
  return {
    title: resource.title,
    detail,
    href: isUnit ? `/resources/materials/${resource.id}` : `/resources/${resource.id}`,
  };
}
