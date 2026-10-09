'use client';

import { useEffect, type RefObject } from 'react';

/** 아래에서 올라오는 입력창. 큰 화면에서는 가운데 뜬다. */
export const SHEET_DIALOG_CLASS =
  'fixed inset-x-0 top-auto m-0 mx-auto w-full max-w-lg scroll-pb-24 overflow-y-auto overscroll-contain rounded-t-2xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/40 sm:rounded-2xl';

/**
 * 붙자마자 모달로 열고, 사라질 때 닫고 초점을 돌려준다.
 * 휴대폰 키보드가 올라오면 보이는 영역(visualViewport)에 맞춰 높이와 바닥을 옮긴다.
 * 그러지 않으면 저장 단추가 키보드 뒤로 숨는다.
 */
export function useSheetDialog(ref: RefObject<HTMLDialogElement | null>) {
  useEffect(() => {
    const element = ref.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    const viewport = window.visualViewport;
    const size = () => {
      const height = viewport?.height ?? window.innerHeight;
      element.style.maxHeight = `${Math.max(100, height - 16)}px`;
      element.style.bottom = `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0))}px`;
    };
    size();
    viewport?.addEventListener('resize', size);
    viewport?.addEventListener('scroll', size);
    return () => {
      viewport?.removeEventListener('resize', size);
      viewport?.removeEventListener('scroll', size);
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [ref]);
}
