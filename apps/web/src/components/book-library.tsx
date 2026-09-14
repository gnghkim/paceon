'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { useWorkspace } from '@/components/workspace-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { formatDate, summarizeBook } from '@/lib/planning';

export function BookCover({
  url,
  title,
  large = false,
}: {
  url: string | null;
  title: string;
  large?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-muted-foreground ${large ? 'h-44 w-28' : 'h-24 w-16'}`}
    >
      {url && failedUrl !== url ? (
        // eslint-disable-next-line @next/next/no-img-element -- External book covers have a graceful local fallback.
        <img
          src={url}
          alt={`${title} 표지`}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <BookOpen
          className={large ? 'size-10' : 'size-6'}
          aria-label="표지 없음"
        />
      )}
    </div>
  );
}

export function BookLibrary() {
  const { data, loading, error, reload } = useWorkspace();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const books =
    data?.resources.filter(
      (book) =>
        (filter === 'all' || book.status === filter) &&
        `${book.title} ${book.author ?? ''}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight">내 서재</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            읽고 있는 책과 앞으로의 여정을 한곳에서 확인하세요.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link href="/resources/import">PDF 가져오기</Link></Button>
        <Button asChild>
          <Link href="/resources/new">
            <Plus className="size-4" />책 추가
          </Link>
        </Button>
        </div>
      </header>
      <div className="flex flex-col justify-between gap-3 sm:flex-row">
        <div className="flex gap-1" aria-label="도서 상태 필터">
          {[
            ['all', '전체'],
            ['ACTIVE', '읽는 중'],
            ['COMPLETED', '완독'],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant={filter === value ? 'secondary' : 'ghost'}
              aria-pressed={filter === value}
              onClick={() => setFilter(value!)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input
            aria-label="서재에서 제목 또는 저자 검색"
            placeholder="제목 또는 저자 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      {loading ? (
        <div role="status" aria-label="서재 불러오는 중" className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : error ? (
        <Card className="space-y-4 p-6">
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={reload}>
            다시 불러오기
          </Button>
        </Card>
      ) : books.length === 0 ? (
        <Card className="px-6 py-16 text-center">
          <BookOpen className="mx-auto mb-4 size-9 text-muted-foreground" />
          <h2 className="text-lg font-semibold">
            {data?.resources.length
              ? '조건에 맞는 책이 없어요'
              : '첫 번째 책을 서재에 담아 보세요'}
          </h2>
          <p className="mb-6 mt-2 text-sm text-muted-foreground">
            {data?.resources.length
              ? '다른 제목으로 검색하거나 필터를 바꿔 보세요.'
              : '현재 읽은 페이지부터 나에게 맞는 독서 계획을 만들 수 있어요.'}
          </p>
          {data?.resources.length ? (
            <Button
              variant="outline"
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              검색과 필터 초기화
            </Button>
          ) : (
            <Button asChild>
              <Link href="/resources/new">책 추가하기</Link>
            </Button>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {books.map((book) => {
            const bookPlans =
              data?.plans.filter((p) => p.resource_id === book.id) ?? [];
            const plan =
              bookPlans.find((p) => p.status === 'ACTIVE') ??
              bookPlans
                .filter((p) => p.status === 'COMPLETED')
                .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            const baseline = summarizeBook(book, plan);
            const progress = data?.progress[book.id];
            const summary = {
              ...baseline,
              completed: progress?.completedThroughPage ?? baseline.completed,
              percent: progress?.percent ?? baseline.percent,
            };
            return (
              <Link
                key={book.id}
                href={`/resources/${book.id}`}
                className="block rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Card className="flex items-center gap-4 p-4 transition-colors hover:bg-accent/30 md:gap-6 md:p-6">
                  <BookCover url={book.cover_url} title={book.title} />
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {book.source === 'PDF_IMPORT' && <span>PDF · </span>}
                      {book.replan_required
                        ? '일정 조정 대기'
                        : book.status === 'COMPLETED'
                          ? '완독'
                          : plan
                            ? '계획 진행 중'
                            : '계획 대기'}
                    </p>
                    <h2 className="break-words text-lg font-semibold">
                      {book.title}
                    </h2>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {book.author || '저자 정보 없음'}
                    </p>
                    <div className="mt-4 max-w-sm">
                      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                        <span>
                          현재 진도 · {summary.completed} / {book.total_pages}쪽
                        </span>
                        <span>{summary.percent}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${summary.percent}%` }}
                        />
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground sm:hidden">
                      예상 완독 ·{' '}
                      {book.status === 'COMPLETED'
                        ? '이미 완독한 책'
                        : formatDate(summary.forecast)}
                    </p>
                  </div>
                  <div className="hidden text-right sm:block">
                    <p className="text-xs text-muted-foreground">예상 완독</p>
                    <p className="mt-2 text-sm font-medium">
                      {book.status === 'COMPLETED'
                        ? '이미 완독한 책'
                        : formatDate(summary.forecast)}
                    </p>
                    {summary.target && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        목표 {formatDate(summary.target)}
                      </p>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
