export type LibraryType = 'all' | 'books' | 'materials';
export type BookStatusFilter = 'all' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
type SearchableResource = { title: string; author: string | null; status: string };

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
  const books = type === 'materials' ? [] : resources.filter(item =>
    (bookStatus === 'all' ? item.status !== 'ARCHIVED' : item.status === bookStatus) && matches(item));
  const units = type === 'books' ? [] : materials.filter(item => item.status !== 'ARCHIVED' && matches(item));
  const empty = books.length || units.length ? null
    : !resources.length && !materials.length ? 'library'
      : (type === 'books' && !resources.length) || (type === 'materials' && !materials.length) ? 'type'
        : needle ? 'search' : 'filter';
  return { books, materials: units, empty };
}
