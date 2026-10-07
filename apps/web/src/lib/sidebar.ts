/**
 * 사이드바 접힘 여부. 이 브라우저에만 기억하는 편의 설정이라 기기 저장소에 둔다.
 * 저장소가 막혀 있거나 비어 있으면 펼친 상태로 시작한다.
 */
export const SIDEBAR_KEY = 'paceon:sidebar-collapsed';

type Readable = Pick<Storage, 'getItem'> | undefined;
type Writable = Pick<Storage, 'setItem'> | undefined;

export function readSidebarCollapsed(storage: Readable): boolean {
  try {
    return storage?.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(storage: Writable, collapsed: boolean) {
  try {
    storage?.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  } catch {
    /* 기억하지 못해도 지금 화면은 바뀐다. */
  }
}

/** window.localStorage는 사이트 데이터가 막혀 있으면 읽는 순간 예외를 던진다. */
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}
