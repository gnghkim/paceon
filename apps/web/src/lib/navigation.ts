export const primaryNavigation = [
  { href: '/today', label: '오늘' },
  { href: '/learn', label: '영어 학습' },
  { href: '/calendar', label: '캘린더' },
  { href: '/resources', label: '서재' },
  { href: '/statistics', label: '통계' },
] as const;

export function activeNavigation(pathname: string): string | null {
  if (pathname === '/review' || pathname === '/learn/review') return '/today';
  return primaryNavigation.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))?.href ?? null;
}

export function pageTitle(pathname: string): string {
  const titles: Record<string, string> = {
    '/settings': '설정',
    '/review': '오늘의 복습',
    '/learn/review': '오늘의 복습',
    '/learn/words': '단어장',
    '/resources/add': '자료 추가',
    '/resources/new': '책 추가',
    '/resources/import': 'PDF 가져오기',
    '/resources/materials/new': '교재·강의 추가',
  };
  return titles[pathname] ?? primaryNavigation.find(item => item.href === activeNavigation(pathname))?.label ?? 'PaceOn';
}
