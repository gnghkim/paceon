export type LibraryType = 'all' | 'books' | 'materials';
/** ACTIVE는 읽기 시작한 책, NOT_STARTED는 담기만 한 책이다. 완독에는 재독 중인 책도 든다. */
export type BookStatusFilter = 'all' | 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
type SearchableResource = { title: string; author: string | null; status: string; reading_started_at?: string | null };

function inFilter(item: SearchableResource, status: BookStatusFilter) {
  if (status === 'all') return item.status !== 'ARCHIVED';
  if (status === 'NOT_STARTED') return item.status === 'ACTIVE' && !item.reading_started_at;
  if (status === 'ACTIVE') return item.status === 'ACTIVE' && !!item.reading_started_at;
  return item.status === status;
}

export function filterLibrary<T extends SearchableResource>(
  resources: T[],
  materials: T[],
  type: LibraryType,
  status: BookStatusFilter,
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  const matches = (item: T) => `${item.title} ${item.author ?? ''}`.toLocaleLowerCase().includes(needle);
  const bookStatus = type === 'books' ? status : 'all';
  const books = type === 'materials' ? [] : resources.filter(item => inFilter(item, bookStatus) && matches(item));
  const units = type === 'books' ? [] : materials.filter(item => item.status !== 'ARCHIVED' && matches(item));
  const empty = books.length || units.length ? null
    : !resources.length && !materials.length ? 'library'
      : (type === 'books' && !resources.length) || (type === 'materials' && !materials.length) ? 'type'
        : needle ? 'search' : 'filter';
  return { books, materials: units, empty };
}
