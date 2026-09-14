'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { PdfImportView, PdfParseResult } from '@/lib/pdf-types';

const active = (item: PdfImportView) => ['UPLOADING', 'PENDING', 'PROCESSING'].includes(item.status);
const statusLabels = { UPLOADING: '업로드 확인 대기', PENDING: '추출 대기', PROCESSING: '페이지와 목차 추출 중', READY: '등록 준비 완료', FAILED: '추출 실패', IMPORTED: '서재 등록 완료' };
const warningLabels = { NO_TEXT: '텍스트를 추출하지 못했어요. 스캔 문서는 문자 인식 없이 페이지 수만 사용할 수 있어요.', NO_OUTLINE: 'PDF 책갈피가 없어 문서 전체를 하나의 학습 단원으로 만들었어요.', TRUNCATED_TEXT: '본문 일부만 추출했어요. AI 분석에 전체 내용이 포함되지는 않아요.', INVALID_OUTLINE: '책갈피 구성을 사용할 수 없어 문서 전체를 하나의 학습 단원으로 만들었어요.' };

export function PdfResultDetails({ result }: { result: PdfParseResult }) {
  return <div className="space-y-3">
    <p className="text-sm">{result.pageCount}쪽 · {result.units.length}개 학습 단원</p>
    {result.warnings.length > 0 && <ul className="space-y-2 rounded-lg bg-muted p-3 text-sm text-muted-foreground">{result.warnings.map((warning) => <li key={warning}>{warningLabels[warning]}</li>)}</ul>}
    <details className="text-sm"><summary className="cursor-pointer font-medium">추출한 학습 단원 보기</summary>
      <ol className="mt-3 max-h-64 space-y-2 overflow-auto">{result.units.map((unit, index) => <li key={index} className="flex justify-between gap-4"><span className="break-words">{unit.title}</span><span className="shrink-0 text-muted-foreground">{unit.startPage}–{unit.endPage}쪽</span></li>)}</ol>
    </details>
  </div>;
}

export function PdfImport() {
  const { session } = useAuth();
  return session ? <ImportPanel key={session.user.id} /> : null;
}

function ImportPanel() {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<{ available: boolean; imports: PdfImportView[] } | null>(null);
  const [selection, setSelection] = useState<{ file: File; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cleanupRetries, setCleanupRetries] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [paused, setPaused] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + 10 * 60 * 1000;
    async function poll() {
      try {
        const response = await apiFetch('/api/pdf-imports', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const next: { available: boolean; imports: PdfImportView[] } = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(next);
        if (next.imports.some(active)) {
          if (Date.now() < deadline) timer = setTimeout(poll, 3000);
          else setPaused(true);
        }
      } catch {
        if (!controller.signal.aborted) setError('가져오기 상태를 확인하지 못했어요. 상태를 다시 확인해 주세요.');
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiFetch, refresh]);

  function checkStatus() { setPaused(false); setRefresh((value) => value + 1); }
  async function run(id: string, init: RequestInit, uploading = false) {
    if (mutation.current) return;
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(id); setError('');
    try {
      const response = await apiFetch(uploading ? '/api/pdf-imports' : `/api/pdf-imports/${encodeURIComponent(id)}`, { ...init, signal: controller.signal });
      if (!response.ok) {
        if (uploading && [400, 413, 415].includes(response.status)) {
          const payload: { error?: unknown } | null = await response.json().catch(() => null);
          const message = typeof payload?.error === 'string' && payload.error.length <= 500
            ? payload.error.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
            : '';
          throw new Error(message || 'PDF 파일 형식과 이름, 크기를 확인해 주세요. 최대 10 MiB까지 가져올 수 있어요.');
        }
        throw new Error(response.status === 429 ? '진행 중인 가져오기가 많아요. 완료된 후 다시 시도해 주세요.' : response.status === 409 ? '가져오기 상태가 바뀌었어요. 상태를 확인한 뒤 다시 시도해 주세요.' : response.status === 503 && init.method === 'DELETE' ? '목록 정리 후 원본 파일 삭제를 완료하지 못했을 수 있어요. 상태를 다시 확인해 주세요.' : '요청 결과를 확인하지 못했어요. 상태를 확인한 뒤 다시 시도해 주세요. 업로드 재시도는 같은 파일과 요청 번호를 사용해요.');
      }
      if (response.status !== 204) {
        const payload: { resourceId?: string } = await response.json();
        if (controller.signal.aborted) return;
        if (payload.resourceId) { router.push(`/resources/${payload.resourceId}`); return; }
      }
      if (controller.signal.aborted) return;
      if (init.method === 'DELETE' && response.status === 204) setCleanupRetries((previous) => previous.filter((pendingId) => pendingId !== id));
      if (uploading || selection?.id === id && init.method === 'DELETE') { setSelection(null); if (fileInput.current) fileInput.current.value = ''; }
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (init.method === 'DELETE') setCleanupRetries((previous) => previous.includes(id) ? previous : [...previous, id]);
        setError(cause instanceof Error ? cause.message : '요청에 실패했어요. 다시 시도해 주세요.');
      }
    } finally {
      if (!controller.signal.aborted) { mutation.current = null; setBusy(null); checkStatus(); }
    }
  }
  function upload(event: FormEvent) {
    event.preventDefault();
    if (!selection) return;
    void run(selection.id, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Import-Id': selection.id, 'X-File-Name': encodeURIComponent(selection.file.name) }, body: selection.file }, true);
  }
  return <div className="mx-auto max-w-3xl space-y-6">
    <Button asChild variant="ghost"><Link href="/resources">← 내 서재</Link></Button>
    <header><h1 className="text-2xl font-bold">PDF 가져오기</h1><p className="mt-2 text-sm text-muted-foreground">페이지와 책갈피를 추출하고 확인한 뒤 서재에 등록해요. 화면을 떠나도 추출 작업은 계속돼요.</p></header>
    <Card className="space-y-4 p-4 md:p-6"><form onSubmit={upload} className="space-y-3">
      <label htmlFor="pdf-file" className="text-sm font-medium">PDF 파일 선택</label>
      <Input ref={fileInput} id="pdf-file" type="file" accept="application/pdf,.pdf" disabled={busy !== null || !snapshot?.available} onChange={(event) => {
        const file = event.target.files?.[0];
        setError('');
        if (!file) { setSelection(null); return; }
        if (file.size === 0 || file.size > 10485760) { setError('0바이트보다 크고 10 MiB 이하인 PDF를 선택해 주세요.'); setSelection(null); event.target.value = ''; return; }
        setSelection({ file, id: crypto.randomUUID() });
      }} />
      <p className="text-xs text-muted-foreground">최대 10 MiB · 500쪽 · 암호화된 PDF는 지원하지 않아요. 원본은 비공개로 보관돼요.</p>
      {snapshot?.available === false && <p role="status" className="text-sm">지금은 새 PDF를 가져올 수 없어요. 기존 작업의 상태는 확인할 수 있어요.</p>}
      <Button type="submit" disabled={!selection || busy !== null || !snapshot?.available}>{busy === selection?.id ? '업로드 중…' : '업로드 / 같은 파일 재시도'}</Button>
    </form></Card>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {cleanupRetries.map((id) => <Card key={id} className="space-y-3 p-4">
      <p className="text-sm">삭제 요청의 완료 여부를 확인하지 못했어요. 같은 PDF 원본의 정리를 다시 시도할 수 있어요.</p>
      <p className="break-all text-xs text-muted-foreground">요청 번호: {id}</p>
      <Button variant="outline" disabled={busy !== null} onClick={() => void run(id, { method: 'DELETE' })}>원본 정리 다시 시도</Button>
    </Card>)}
    {paused && <p role="status" className="text-sm">자동 확인을 잠시 멈췄어요. 상태를 다시 확인해 주세요.</p>}
    <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">최근 가져오기</h2><Button variant="outline" onClick={checkStatus} disabled={busy !== null}>상태 다시 확인</Button></div>
    {!snapshot && !error && <p role="status">가져오기 목록을 불러오는 중…</p>}
    {snapshot?.imports.length === 0 && <p className="text-sm text-muted-foreground">아직 가져온 PDF가 없어요.</p>}
    {snapshot?.imports.map((item) => <Card key={item.id} className="space-y-4 p-4 md:p-6">
      <div><h3 className="break-words font-semibold">{item.filename}</h3><p role="status" className="mt-1 text-sm text-muted-foreground">{statusLabels[item.status]} · {(item.fileSize / 1048576).toFixed(1)} MiB</p></div>
      {item.status === 'FAILED' && <p className="text-sm">PDF를 추출하지 못했어요. 파일이 정상인지 확인해 주세요.{item.errorCode && <span className="ml-1 text-muted-foreground">({item.errorCode})</span>}</p>}
      {item.status === 'UPLOADING' && <p className="text-sm text-muted-foreground">업로드가 완료되지 않았어요. 이 화면에서 선택한 파일은 같은 요청으로 재시도할 수 있어요. 화면을 새로 열었다면 이 항목을 삭제하고 파일을 다시 선택해 주세요.</p>}
      {item.status === 'READY' && item.result && <Review key={item.id} item={item} busy={busy !== null} onConfirm={(title, currentPage) => void run(item.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', title, currentPage }) })} />}
      <div className="flex flex-wrap gap-2">
        {item.status === 'IMPORTED' && item.resourceId && <Button asChild variant="outline"><Link href={`/resources/${item.resourceId}`}>서재에서 보기</Link></Button>}
        {item.status === 'FAILED' && <Button variant="outline" disabled={busy !== null || !snapshot.available} onClick={() => void run(item.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'retry' }) })}>추출 다시 시도</Button>}
        {item.status !== 'IMPORTED' && item.status !== 'PROCESSING' && <Button variant="ghost" disabled={busy !== null} onClick={() => void run(item.id, { method: 'DELETE' })}>가져오기와 원본 삭제</Button>}
      </div>
    </Card>)}
  </div>;
}

function Review({ item, busy, onConfirm }: { item: PdfImportView; busy: boolean; onConfirm: (title: string, currentPage: number) => void }) {
  const [title, setTitle] = useState(item.result?.title ?? item.filename);
  const [currentPage, setCurrentPage] = useState('0');
  const result = item.result!;
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (title.trim() && currentPage !== '' && Number.isInteger(Number(currentPage))) onConfirm(title.trim(), Number(currentPage)); }}>
    <PdfResultDetails result={result} />
    <div className="space-y-2"><label htmlFor={`title-${item.id}`} className="text-sm font-medium">서재에 표시할 제목</label><Input id={`title-${item.id}`} value={title} maxLength={500} required disabled={busy} onChange={(event) => setTitle(event.target.value)} /></div>
    <div className="space-y-2"><label htmlFor={`page-${item.id}`} className="text-sm font-medium">현재까지 읽은 페이지</label><Input id={`page-${item.id}`} type="number" min={0} max={result.pageCount} step={1} required value={currentPage} disabled={busy} onChange={(event) => setCurrentPage(event.target.value)} /><p className="text-xs text-muted-foreground">아직 읽지 않았다면 0 · PDF 파일의 페이지 순서를 기준으로 기록해요.</p></div>
    <Button type="submit" disabled={busy || !title.trim()}>확인하고 서재에 등록</Button>
  </form>;
}
