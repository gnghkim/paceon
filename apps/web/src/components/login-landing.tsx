import type { ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  CalendarCheck,
  Check,
  Headphones,
  Maximize2,
  Pause,
  Plus,
  Timer,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

/**
 * 로그인 화면 아래로 이어지는 소개. 처음 온 사람이 가입 전에 무엇을 하는 앱인지 본다.
 *
 * 화면 예시는 그림이 아니라 같은 토큰으로 그린 마크업이다. 어두운 화면을 그대로
 * 따라가고, 실제 화면이 바뀌면 여기만 고치면 된다. 숫자와 책 제목은 예시이며
 * 실제 사용자의 기록이 아니다. 없는 기능과 효과를 약속하는 문구는 쓰지 않는다.
 */
export function LoginLanding({ onStart }: { onStart: (mode: 'login' | 'signup') => void }) {
  return (
    <div id="about">
      <section aria-labelledby="how-title" className="px-6 py-20 sm:px-12 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            id="how-title"
            eyebrow="쓰는 법"
            title="어떻게 쓰나요?"
            lead="계획하고, 오늘 몫만 하고, 남긴다. 세 단계면 됩니다."
          />
          <div className="mt-16 space-y-20 lg:space-y-28">
            <Step
              number="01"
              title="책을 넣고 계획을 만듭니다"
              body="책을 검색하거나 직접 등록하고, 하루 분량이나 끝내고 싶은 날을 정하세요. 요일마다 낼 수 있는 시간에 맞춰 일정이 나뉩니다."
              points={['PDF에서 쪽수와 목차 가져오기', '하루 분량 또는 목표일 기준', '여러 권이 한 주의 시간을 나눠 씀']}
              mock={<PlanMock />}
              mockLabel="계획 예시: 하루 20쪽, 요일별 가용 시간, 예상 완독일"
            />
            <Step
              flip
              number="02"
              title="오늘 분량만 읽고 기록합니다"
              body="오늘 화면에는 오늘 읽을 만큼만 나옵니다. 읽기 시작으로 시간을 재고, 끝내면 어디까지 읽었는지만 적으면 됩니다. 밀린 날을 나무라지 않고 남은 일정을 다시 나눕니다."
              points={['잠시 멈춤과 집중 화면이 있는 독서 타이머', '기록하면 남은 일정을 다시 계산', '정한 시각에 하루 한 번 알림']}
              mock={<ReadingMock />}
              mockLabel="독서 타이머 예시: 읽는 중 24분 18초, 오늘 읽을 일정 카드"
            />
            <Step
              number="03"
              title="영어도 같은 자리에서 이어 갑니다"
              body="YouTube 링크로 듣고, 말하고, 씁니다. 공부하다 만난 단어는 그 자리에서 담으면 AI가 뜻과 예문을 채우고, 다음 날부터 복습에 나옵니다."
              points={['구간 반복, 배속, 시각별 메모', 'AI 첨삭과 말하기 피드백', '1·3·7·14·30일 간격 복습']}
              mock={<WordsMock />}
              mockLabel="단어장 예시: 단어 담기 입력칸과 뜻, 예문이 채워진 단어 카드"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="preview-title" className="bg-primary-soft px-6 py-20 sm:px-12 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            id="preview-title"
            eyebrow="오늘 화면"
            title="열면 오늘 할 일부터 보입니다"
            lead="오늘의 분량, 이번 주의 흐름, 영어 학습과 복습이 한 화면에 있습니다."
          />
          <TodayMock />
          <p className="mt-4 text-center text-xs text-muted-foreground">
            예시 화면입니다. 책과 숫자는 실제 기록이 아닙니다.
          </p>
        </div>
      </section>

      <section aria-labelledby="features-title" className="px-6 py-20 sm:px-12 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <SectionHeading
            id="features-title"
            eyebrow="기능"
            title="PaceOn으로 할 수 있는 것"
            lead="계획을 세우는 데서 끝나지 않고, 매일 돌아오게 하는 데 필요한 것들입니다."
          />
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-xl border border-border bg-card p-6">
                <span className="flex size-10 items-center justify-center rounded-lg bg-accent text-primary">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="start-title" className="px-6 pb-20 sm:px-12 lg:pb-28">
        <div className="mx-auto max-w-5xl rounded-2xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
          <h2 id="start-title" className="text-2xl leading-snug font-bold tracking-tight sm:text-3xl">
            오늘 읽을 만큼만,
            <br />
            내 속도로.
          </h2>
          {/* 투명도를 주면 밝은 화면에서 작은 글씨 대비가 4.5 아래로 내려간다. */}
          <p className="mx-auto mt-4 max-w-md text-sm leading-6">
            가입하고 첫 책을 등록하면 오늘 읽을 분량이 바로 나옵니다.
          </p>
          <Button
            type="button"
            size="lg"
            variant="outline"
            // 띠와 반대 색을 쓴다. 밝은 화면에서는 흰 단추, 어두운 화면에서는 어두운 단추가 된다.
            className="mt-8 border-transparent bg-background text-foreground hover:bg-background/90"
            onClick={() => onStart('signup')}
          >
            가입하기
            <ArrowRight aria-hidden="true" />
          </Button>
          <p className="mt-5 text-sm">
            이미 계정이 있나요?{' '}
            <button
              type="button"
              className="rounded font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
              onClick={() => onStart('login')}
            >
              로그인하기
            </button>
          </p>
        </div>
      </section>
    </div>
  );
}

const features = [
  {
    icon: CalendarCheck,
    title: '학습 계획과 재계획',
    body: '속도, 방식, 목표를 언제든 바꿀 수 있습니다. 잠시 멈추거나 보관해도 기록은 남습니다.',
  },
  {
    icon: Timer,
    title: '독서 타이머',
    body: '화면이 꺼져도 실제 흐른 시간으로 잽니다. 끝내면 읽은 시간이 기록에 채워집니다.',
  },
  {
    icon: Bell,
    title: '매일 알림과 설치',
    body: '홈 화면에 설치해 앱처럼 열고, 정한 시각에 오늘 할 분량을 한 줄로 받습니다.',
  },
  {
    icon: Headphones,
    title: '듣기, 말하기, 쓰기',
    body: 'YouTube로 듣고 구간을 따라 말하고 글을 씁니다. AI에는 버튼을 눌렀을 때만 보냅니다.',
  },
  {
    icon: BookMarked,
    title: '단어장과 복습',
    body: '단어만 적으면 뜻과 예문이 채워집니다. 하루 세 개씩, 간격을 넓혀 가며 다시 묻습니다.',
  },
  {
    icon: BarChart3,
    title: '통계와 학습 잔디',
    body: '기간별 학습량과 시간, 활동한 날을 봅니다. 연속일은 보조 지표일 뿐 점수가 아닙니다.',
  },
] as const;

function SectionHeading({
  id,
  eyebrow,
  title,
  lead,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
}) {
  return (
    <div className="text-center">
      <p className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
        {eyebrow}
      </p>
      <h2 id={id} className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
        {lead}
      </p>
    </div>
  );
}

function Step({
  number,
  title,
  body,
  points,
  mock,
  mockLabel,
  flip = false,
}: {
  number: string;
  title: string;
  body: string;
  points: readonly string[];
  mock: ReactNode;
  mockLabel: string;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-16">
      <div className={cn(flip && 'lg:order-last')}>
        <p className="font-mono text-sm font-semibold text-primary">{number}</p>
        <h3 className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">{title}</h3>
        <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base">{body}</p>
        <ul className="mt-6 space-y-3 text-sm">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-3">
              <Check size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      {/* 예시 화면은 장식이다. 낭독기에는 한 줄 설명만 전한다. */}
      <div role="img" aria-label={mockLabel} className="min-w-0">
        <div aria-hidden="true" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          {mock}
        </div>
      </div>
    </div>
  );
}

const weekdays = [
  ['월', 30],
  ['화', 30],
  ['수', 0],
  ['목', 30],
  ['금', 20],
  ['토', 60],
  ['일', 60],
] as const;

function PlanMock() {
  return (
    <div className="space-y-5 text-sm">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <BookOpen size={20} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">아주 작은 습관의 힘</p>
          <p className="text-xs text-muted-foreground">320쪽 · 하루 20쪽 · 약 20분</p>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs text-muted-foreground">요일별로 낼 수 있는 시간</p>
        <div className="grid grid-cols-7 gap-1.5">
          {weekdays.map(([day, minutes]) => (
            <div
              key={day}
              className={cn(
                'rounded-lg py-2 text-center',
                minutes ? 'bg-primary-soft' : 'bg-surface-subtle text-muted-foreground',
              )}
            >
              <p className="text-xs">{day}</p>
              <p className="mt-0.5 text-xs font-semibold">{minutes ? `${minutes}분` : '쉼'}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-surface-subtle px-4 py-3">
        <span className="text-muted-foreground">예상 완독</span>
        <span className="font-semibold">10월 9일</span>
      </div>
    </div>
  );
}

function ReadingMock() {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">읽는 중 · 아주 작은 습관의 힘</p>
            <p className="font-mono text-3xl leading-tight font-semibold text-primary tabular-nums">
              24:18
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium">
            <Maximize2 size={14} />
            집중 화면
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-medium">
          <span className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface py-2.5">
            <Pause size={14} />
            잠시 멈춤
          </span>
          <span className="flex items-center justify-center rounded-lg bg-primary py-2.5 text-primary-foreground">
            다 읽었어요
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-border p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
          <Check size={18} />
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium">딥 워크</p>
          <p className="text-xs text-muted-foreground">완료 · 20쪽</p>
        </div>
      </div>
    </div>
  );
}

function WordsMock() {
  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-input bg-background px-3 text-muted-foreground">
          put off
        </span>
        <span className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground">
          <Plus size={14} />
          담기
        </span>
      </div>
      <div className="space-y-1.5 rounded-xl border border-border p-4">
        <p className="font-semibold">put off</p>
        <p>미루다, 연기하다</p>
        <p className="text-muted-foreground">Let&apos;s put off the meeting until tomorrow.</p>
        <p className="text-muted-foreground">Don&apos;t put off what you can do today.</p>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-surface-subtle px-4 py-3">
        <span>오늘의 복습</span>
        <span className="font-semibold text-primary">3개</span>
      </div>
    </div>
  );
}

const week = ['done', 'done', 'rest', 'done', 'today', 'ahead', 'ahead'] as const;

function TodayMock() {
  return (
    <div
      role="img"
      aria-label="오늘 화면 예시: 오늘의 분량 두 권, 이번 주 요약, 영어 학습과 복습 카드"
      className="mx-auto mt-12 max-w-3xl"
    >
      <div aria-hidden="true" className="overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
        <div className="flex items-center gap-1.5 border-b border-border bg-surface px-4 py-3">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="ml-3 truncate text-xs text-muted-foreground">PaceOn · 오늘</span>
        </div>
        <div className="grid gap-4 p-5 text-sm sm:grid-cols-5 sm:p-6">
          <div className="space-y-3 sm:col-span-3">
            <div>
              <p className="text-xs text-muted-foreground">9월 19일 금요일</p>
              <p className="mt-1 text-lg font-bold">오늘의 학습</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-medium">아주 작은 습관의 힘</p>
              <p className="mt-0.5 text-xs text-muted-foreground">41–60쪽 · 약 20분</p>
              <span className="mt-3 flex items-center justify-center rounded-lg bg-primary py-2.5 text-xs font-medium text-primary-foreground">
                읽기 시작
              </span>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-success-soft text-success">
                <Check size={16} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-medium">딥 워크</p>
                <p className="text-xs text-muted-foreground">완료 · 20쪽</p>
              </div>
            </div>
          </div>
          <div className="space-y-3 sm:col-span-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">이번 주</p>
              <div className="mt-3 grid grid-cols-7 gap-1">
                {week.map((state, index) => (
                  <span
                    key={index}
                    className={cn(
                      'h-7 rounded-md',
                      state === 'done' && 'bg-primary',
                      state === 'today' && 'border-2 border-primary bg-primary-soft',
                      state === 'rest' && 'bg-surface-muted',
                      state === 'ahead' && 'border border-dashed border-border',
                    )}
                  />
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">3일 읽음 · 60쪽</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">오늘의 영어 학습</p>
                <p className="text-xs text-muted-foreground">12분</p>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-subtle px-3 py-2 text-xs">
                <span>오늘의 복습</span>
                <span className="font-semibold text-primary">3개</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
