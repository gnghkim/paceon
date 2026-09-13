'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import type { BookMetadata, SearchResult } from '@paceon/books';
import { ArrowLeft, Search } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { BookCover } from '@/components/book-library';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

const empty = {
  title: '',
  authors: '',
  totalPages: '',
  currentPage: '0',
  isbn: '',
  publisher: '',
  coverUrl: '',
};
export function BookForm() {
  const { apiFetch } = useAuth();
  const router = useRouter();
  const [entry, setEntry] = useState<'search' | 'manual'>('search');
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState<'yes24' | 'google-books'>('yes24');
  const [results, setResults] = useState<BookMetadata[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<BookMetadata | null>(null);
  const [fields, setFields] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const searchVersion = useRef(0);
  const field = (name: keyof typeof empty) => ({
    value: fields[name],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((f) => ({ ...f, [name]: e.target.value })),
  });
  async function search(e: FormEvent) {
    e.preventDefault();
    const version = ++searchVersion.current;
    setSearching(true);
    setSearchMessage('');
    setResults([]);
    try {
      const response = await fetch(
        `/api/books/search?${new URLSearchParams({ q: query.trim(), provider })}`,
      );
      const payload = (await response.json()) as SearchResult;
      if (version !== searchVersion.current) return;
      if (!response.ok || payload.status !== 'ok')
        throw new Error('unavailable');
      setResults(payload.books);
      if (!payload.books.length)
        setSearchMessage(
          '검색 결과가 없어요. 다른 검색어를 쓰거나 직접 입력해 주세요.',
        );
    } catch {
      if (version === searchVersion.current)
        setSearchMessage(
          '도서 정보를 불러오지 못했어요. 잠시 후 다시 검색하거나 직접 입력해 주세요.',
        );
    } finally {
      if (version === searchVersion.current) setSearching(false);
    }
  }
  function choose(book: BookMetadata) {
    setSelected(book);
    setError('');
    setFields({
      title: book.title,
      authors: book.authors.join(', '),
      totalPages: book.pageCount?.toString() ?? '',
      currentPage: '0',
      isbn: book.isbn ?? '',
      publisher: book.publisher ?? '',
      coverUrl: book.thumbnail ?? '',
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (savingRef.current) return;
    if (Number(fields.currentPage) > Number(fields.totalPages)) {
      setError('읽은 페이지는 전체 페이지보다 클 수 없어요.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await apiFetch('/api/resources/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...fields,
          authors: fields.authors
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean),
          totalPages: Number(fields.totalPages),
          currentPage: Number(fields.currentPage),
          source: selected?.source ?? 'MANUAL',
          ...(selected?.sourceId ? { sourceId: selected.sourceId } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        const message = typeof payload.error === 'string' ? payload.error : '';
        setError(
          response.status === 401
            ? '로그인 시간이 만료됐어요. 다시 로그인해 주세요.'
            : message.includes('isbn')
              ? 'ISBN이 올바르지 않아요. 책의 ISBN을 확인하거나 비워 주세요.'
              : message.includes('coverUrl')
                ? '표지 주소는 https://로 시작하는 주소를 입력해 주세요.'
                : response.status === 400
                  ? '입력 내용을 확인해 주세요. 제목, 전체 페이지와 읽은 페이지가 올바른지 확인해 주세요.'
                  : '책의 저장 결과를 확인하지 못했어요. 서재에서 등록 여부를 먼저 확인해 주세요.',
        );
        return;
      }
      router.push(`/resources/${payload.resource.id}`);
    } catch {
      setError(
        '저장 결과를 확인하지 못했어요. 서재에서 등록 여부를 먼저 확인해 주세요.',
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" className="-ml-3">
        <Link href="/resources">
          <ArrowLeft className="size-4" />내 서재
        </Link>
      </Button>
      <header>
        <h1 className="text-[28px] font-bold tracking-tight">새로운 책 추가</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          책을 찾고, 지금까지 읽은 페이지를 알려 주세요.
        </p>
      </header>
      <Button asChild variant="outline"><Link href="/resources/import">PDF 파일로 가져오기</Link></Button>
      <div className="flex gap-2">
        <Button
          variant={entry === 'search' ? 'secondary' : 'ghost'}
          aria-pressed={entry === 'search'}
          onClick={() => setEntry('search')}
        >
          도서 검색
        </Button>
        <Button
          variant={entry === 'manual' ? 'secondary' : 'ghost'}
          aria-pressed={entry === 'manual'}
          onClick={() => {
            setEntry('manual');
            setSelected(null);
            setFields(empty);
            setError('');
          }}
        >
          직접 입력
        </Button>
      </div>
      {entry === 'search' && (
        <Card className="space-y-4 p-4 md:p-6">
          <label className="block space-y-2 text-sm font-medium">
            <span>검색 서비스</span>
            <select className="h-10 w-full rounded-lg border border-border bg-surface px-3" value={provider} disabled={saving} onChange={(event) => {
              ++searchVersion.current;
              setProvider(event.target.value as 'yes24' | 'google-books');
              setResults([]); setSelected(null); setFields(empty); setSearchMessage(''); setSearching(false); setError('');
            }}>
              <option value="yes24">YES24</option>
              <option value="google-books">Google Books</option>
            </select>
          </label>
          <form onSubmit={search} className="flex gap-2">
            <Input
              aria-label="도서 제목, 저자 또는 ISBN"
              placeholder="제목, 저자 또는 ISBN"
              required
              maxLength={200}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" disabled={searching || !query.trim()}>
              <Search className="size-4" />
              {searching ? '검색 중' : '검색'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            {provider === 'yes24' ? 'YES24' : 'Google Books'}에서 검색합니다. 찾는 책이 없으면 다른 서비스를 선택하거나 직접 입력할 수 있어요.
          </p>
          {searchMessage && (
            <p role="status" className="text-sm">
              {searchMessage}
            </p>
          )}
          {results.length > 0 && (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {results.map((book, index) => (
                <li
                  key={`${book.sourceId}-${index}`}
                  className="flex items-center gap-3 py-4"
                >
                  <BookCover url={book.thumbnail ?? null} title={book.title} />
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-sm font-medium">
                      {book.title}
                    </h2>
                    {book.source === 'YES24' && book.sourceId && /^[1-9]\d*$/.test(book.sourceId) && <a href={`https://www.yes24.com/product/goods/${book.sourceId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline">YES24 도서 정보</a>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {book.authors.join(', ') || '저자 정보 없음'}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {book.publisher}
                      {book.pageCount
                        ? ` · ${book.pageCount}쪽`
                        : ' · 페이지 확인 필요'}
                    </p>
                  </div>
                  <Button
                    variant={selected === book ? 'secondary' : 'outline'}
                    onClick={() => choose(book)}
                  >
                    {selected === book ? '선택됨' : '선택'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {(entry === 'manual' || selected) && (
        <form onSubmit={save}>
          <Card className="space-y-6 p-4 md:p-6">
            <div>
              <h2 className="text-lg font-semibold">도서 정보 확인</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                책에 적힌 정보와 다르다면 수정해 주세요.
              </p>
            </div>
            <fieldset disabled={saving} className="space-y-5">
              <label className="block space-y-2 text-sm font-medium">
                <span>
                  책 제목 <span className="text-primary">*</span>
                </span>
                <Input {...field('title')} required maxLength={500} />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>저자</span>
                <Input
                  {...field('authors')}
                  placeholder="여러 명이면 쉼표로 구분"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2 text-sm font-medium">
                  <span>
                    전체 페이지 <span className="text-primary">*</span>
                  </span>
                  <Input
                    {...field('totalPages')}
                    type="number"
                    min={1}
                    max={10000000}
                    step={1}
                    required
                  />
                </label>
                <label className="block space-y-2 text-sm font-medium">
                  <span>마지막으로 읽은 페이지</span>
                  <Input
                    {...field('currentPage')}
                    type="number"
                    min={0}
                    max={fields.totalPages || 10000000}
                    step={1}
                    required
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                아직 시작하지 않았다면 0을 입력하세요. 다음 페이지부터 계획을
                세웁니다.
              </p>
              <details className="rounded-lg border border-border p-4">
                <summary className="cursor-pointer text-sm font-medium">
                  ISBN·출판사·표지 입력 (선택)
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="block space-y-2 text-sm">
                    <span>ISBN</span>
                    <Input {...field('isbn')} maxLength={32} />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span>출판사</span>
                    <Input {...field('publisher')} maxLength={500} />
                  </label>
                  <label className="block space-y-2 text-sm">
                    <span>표지 이미지 주소 (HTTPS)</span>
                    <Input
                      {...field('coverUrl')}
                      type="url"
                      maxLength={2048}
                      placeholder="https://"
                    />
                  </label>
                </div>
              </details>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? '저장 중…' : '책 저장하고 계획 세우기'}
              </Button>
            </div>
          </Card>
        </form>
      )}
    </div>
  );
}
