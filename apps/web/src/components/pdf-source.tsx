'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PdfResultDetails } from '@/components/pdf-import';
import type { PdfImportView } from '@/lib/pdf-types';

export function PdfSourceCard({ resourceId, onOutline }: { resourceId: string; onOutline: (outline: string) => void }) {
  const { apiFetch } = useAuth();
  const [item, setItem] = useState<PdfImportView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const download = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const endpoint = `/api/resources/books/${encodeURIComponent(resourceId)}/pdf`;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await apiFetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const payload: { import: PdfImportView | null } = await response.json();
        if (controller.signal.aborted) return;
        setItem(payload.import);
        setError('');
        onOutline(payload.import?.result?.analysisOutline ?? '');
      } catch { if (!controller.signal.aborted) setError('PDF 원본 정보를 불러오지 못했어요.'); }
    }
    void load();
    return () => controller.abort();
  }, [apiFetch, endpoint, onOutline, refresh]);
  useEffect(() => {
    const currentUrls = urls.current;
    return () => { download.current?.abort(); currentUrls.forEach((url) => URL.revokeObjectURL(url)); currentUrls.clear(); };
  }, []);
  async function downloadFile() {
    if (download.current || !item) return;
    const controller = new AbortController();
    download.current = controller; setBusy(true); setError('');
    try {
      const response = await apiFetch(`${endpoint}/file`, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urls.current.add(url);
      const link = document.createElement('a');
      link.href = url; link.download = item.filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
    } catch { if (!controller.signal.aborted) setError('원본을 다운로드하지 못했어요. 다시 시도해 주세요.'); }
    finally { if (!controller.signal.aborted) { download.current = null; setBusy(false); } }
  }
  if (!item && !error) return null;
  return <Card className="space-y-4 p-4 md:p-6">
    <h2 className="text-lg font-semibold">PDF 원본</h2>
    {item && <><p className="break-words text-sm text-muted-foreground">{item.filename} · 비공개 보관</p>{item.result && <PdfResultDetails result={item.result} />}
      <p className="text-xs text-muted-foreground">추출한 목차와 본문 일부를 아래 AI 분석 입력란에 준비했어요. 직접 분석을 요청할 때만 해당 내용이 AI에 전달돼요.</p>
      <Button variant="outline" disabled={busy} onClick={() => void downloadFile()}>{busy ? '다운로드 준비 중…' : '원본 PDF 다운로드'}</Button></>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p>{!item && <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>다시 불러오기</Button>}</div>}
  </Card>;
}
