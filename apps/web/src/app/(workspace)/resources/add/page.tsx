import Link from 'next/link';
import { ArrowLeft, BookOpen, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function Page() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/resources" className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />서재로
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight">자료 추가</h1>
        <p className="mt-2 text-sm text-muted-foreground">어떤 자료로 공부할지 골라 주세요.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-4 p-6">
          <BookOpen className="size-7 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-semibold">책</h2>
          <p className="text-sm leading-6 text-muted-foreground">페이지로 진도를 기록하고 독서 계획을 만들어요. 책을 검색하거나 직접 입력할 수 있어요.</p>
          <div className="mt-auto flex flex-col gap-2">
            <Button asChild><Link href="/resources/new">책 검색·직접 입력</Link></Button>
            <Button asChild variant="outline"><Link href="/resources/import">PDF로 책 가져오기</Link></Button>
          </div>
        </Card>
        <Card className="flex flex-col gap-4 p-6">
          <GraduationCap className="size-7 text-primary" aria-hidden="true" />
          <h2 className="text-xl font-semibold">교재·강의</h2>
          <p className="text-sm leading-6 text-muted-foreground">챕터별로 공부하고 진도를 기록해요. 직접 등록하거나 목차를 붙여 넣고, 링크에서 가져올 수도 있어요.</p>
          <Button asChild className="mt-auto"><Link href="/resources/materials/new">교재·강의 추가</Link></Button>
        </Card>
      </div>
    </div>
  );
}
