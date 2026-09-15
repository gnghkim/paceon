# 학습 잔디(히트맵) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GitHub Contribution Graph처럼 하루 학습량(도서 기록 분 + 학습실 시간)을 색 진하기로 보여주는 잔디 그래프를 통계 화면(1년)과 오늘 화면(12주 요약 + 연속일)에 추가한다.

**Architecture:** 새 Postgres 함수 `public.learning_daily_minutes(from,to)`가 `learning_private.activity_segments`(학습실 UTC 구간)를 저장된 시간대 기준 지역 날짜별 분으로 집계한다. 기존 `GET /api/statistics`가 이 함수를 한 번 더 호출해 도서 기록과 병합하고, 프런트엔드 순수 함수(`study-heatmap.ts`)가 병합된 일별 데이터를 색 단계·연속일로 변환해 공용 컴포넌트(`StudyHeatmap`)로 렌더링한다.

**Tech Stack:** Supabase Postgres 17 (PL/pgSQL, pgTAP), Next.js 16.3 App Router, React 19, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-study-heatmap-design.md`

## Global Constraints

- 브랜치: `main`에서 `feat/study-heatmap`을 새로 만들어 작업한다. 태스크마다 커밋한다.
- 색 단계는 고정 기준이다: 0=기록없음, 1=(0<분<15) 또는 (분=0이고 시간 미입력 기록 있음), 2=15–29분, 3=30–59분, 4=60분 이상.
- `learning_daily_minutes`는 `auth.uid()`로 본인 행만 반환하고, `learning_private.activity_segments`는 이 함수 외에 어떤 경로로도 조회할 수 없다.
- `resourceId` 필터와 무관하게 학습실 시간은 항상 전체 계정 기준으로 합산한다(학습실 공간은 책에 연결되지 않으므로).
- RPC 실패는 `/api/statistics` 전체를 503으로 실패시킨다.
- 새 파일의 상대 import는 이 저장소의 기존 관례를 따른다: `apps/web/src/lib/*.ts` 파일끼리는 `.ts` 확장자를 명시한 상대 경로(`./statistics.ts`)를, `apps/web/src/components/*.tsx` 파일은 확장자 없는 `@/lib/...` 별칭과 확장자 없는 상대 `./...`를 쓴다(각 태스크의 정확한 import 문을 그대로 쓴다).
- `tsconfig.base.json`은 `noUncheckedIndexedAccess: true`다. 배열 인덱스 접근 시 타입 오류가 나면 `!`나 옵셔널 체이닝으로 처리한다.
- 새 테스트 파일은 `scripts/test-unit.mjs`가 `tests/*.test.mjs`를 자동으로 찾으므로 `package.json`을 수정하지 않는다. `*-integration.test.mjs`만 예외로 자동 실행에서 빠진다.
- UI 컴포넌트(`.tsx`)는 이 저장소 관례상 자동화된 렌더링 테스트를 두지 않는다. typecheck·lint·build로 정적 검증하고 마지막 태스크에서 브라우저로 확인한다.

---

### Task 1: DB — 학습실 일별 분 집계 함수

**Files:**
- Create: `supabase/migrations/20261002000000_learning_daily_minutes.sql`
- Create: `supabase/tests/learning_daily_minutes.test.sql`
- Modify: `packages/shared/src/database.types.ts` (재생성, 손으로 편집하지 않음)

**Interfaces:**
- Produces: `public.learning_daily_minutes(p_from date, p_to date) returns table(study_date date, minutes numeric)`, `authenticated`에게만 실행 권한. Task 2가 PostgREST로 `POST /rest/v1/rpc/learning_daily_minutes` `{p_from,p_to}`를 호출해 소비한다.

- [ ] **Step 1: 로컬 Supabase 준비 확인**

Run: `supabase status`
Expected: 실행 중(`API URL` 등 출력). 꺼져 있으면 `supabase start`.

- [ ] **Step 2: 실패하는 pgTAP 작성**

Create `supabase/tests/learning_daily_minutes.test.sql`:

```sql
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_function('public','learning_daily_minutes',array['date','date'],'Daily minutes RPC exists');

insert into auth.users(id,email) values
 ('40000000-0000-4000-8000-000000000001','heatmap-owner@paceon.example'),
 ('40000000-0000-4000-8000-000000000002','heatmap-other@paceon.example');
insert into learning_workspaces(id,user_id,title,kind) values
 ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Owner room','WRITING'),
 ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','Other room','WRITING');
insert into learning_sessions(id,user_id,workspace_id,status,device_id,lease_expires_at,last_seen_at,last_activity_at,timezone) values
 ('42000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','ENDED',gen_random_uuid(),'2026-09-13 15:30:00+00','2026-09-13 15:30:00+00','2026-09-13 15:30:00+00','Asia/Seoul'),
 ('42000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','ENDED',gen_random_uuid(),'2026-09-10 05:00:00+00','2026-09-10 05:00:00+00','2026-09-10 05:00:00+00','America/New_York'),
 ('42000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','ENDED',gen_random_uuid(),'2026-01-01 00:10:00+00','2026-01-01 00:10:00+00','2026-01-01 00:10:00+00','Asia/Seoul'),
 ('42000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','ENDED',gen_random_uuid(),'2026-09-13 15:00:00+00','2026-09-13 15:00:00+00','2026-09-13 15:00:00+00','Asia/Seoul');
-- Midnight crossing in Asia/Seoul: 23:50~00:30 KST = 14:50~15:30 UTC, split 10min/30min across the two local dates.
insert into learning_private.activity_segments(session_id,user_id,started_at,ended_at,timezone) values
 ('42000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','2026-09-13T14:50:00+00','2026-09-13T15:30:00+00','Asia/Seoul'),
 -- Single local day in America/New_York (EDT, UTC-4): 04:00~05:00 UTC = 00:00~01:00 local, no split.
 ('42000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','2026-09-10T04:00:00+00','2026-09-10T05:00:00+00','America/New_York'),
 -- Outside the queried range below; must never appear.
 ('42000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','2026-01-01T00:00:00+00','2026-01-01T00:10:00+00','Asia/Seoul'),
 -- Belongs to the other user; must never leak into owner's totals.
 ('42000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','2026-09-13T14:00:00+00','2026-09-13T15:00:00+00','Asia/Seoul');

set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select is((select minutes from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-09-13'),10::numeric,'Midnight-crossing segment credits 10 minutes to the earlier local date');
select is((select minutes from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-09-14'),30::numeric,'Midnight-crossing segment credits 30 minutes to the later local date');
select is((select minutes from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-09-10'),60::numeric,'A same-day segment in a different stored timezone is not split');
select is((select count(*) from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-01-01'),0::bigint,'A segment outside the requested range is excluded');
select is((select count(*) from learning_daily_minutes('2026-09-01','2026-09-30')),3::bigint,'Only the three in-range owner dates are returned');
select is((select count(*) from learning_daily_minutes('2026-09-14','2026-09-01')),0::bigint,'A reversed range returns nothing');
select is((select count(*) from learning_daily_minutes('2020-01-01','2026-12-31')),0::bigint,'A range spanning more than 366 days returns nothing');
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
select is((select count(*) from learning_daily_minutes('2026-09-01','2026-09-30') where study_date in ('2026-09-13','2026-09-14')),1::bigint,'Other user only sees their own single-day total, none of the owner''s split minutes');
reset role;
select throws_ok($$select * from learning_daily_minutes('2026-09-01','2026-09-30')$$,'42501',null,'Anonymous role cannot call the RPC');
select * from finish();
rollback;
```

- [ ] **Step 3: 실패 확인**

Run: `supabase test db`
Expected: `learning_daily_minutes.test.sql` FAIL (`function learning_daily_minutes(date,date) does not exist`).

- [ ] **Step 4: migration 작성**

Create `supabase/migrations/20261002000000_learning_daily_minutes.sql`:

```sql
-- Speeds up learning_daily_minutes' per-user scan; the primary key alone is (session_id, started_at).
create index activity_segments_user_started on learning_private.activity_segments(user_id, started_at);

-- Splits one UTC interval into per-local-day seconds using the timezone stored on the segment,
-- so a later timezone preference change never reinterprets an already-recorded segment's date.
create function learning_private.segment_days(p_started timestamptz, p_ended timestamptz, p_tz text)
returns table(study_date date, seconds numeric) language sql immutable set search_path='' as $$
  select d::date,
    extract(epoch from (
      least(p_ended, (d + interval '1 day') at time zone p_tz) -
      greatest(p_started, d at time zone p_tz)
    ))
  from generate_series(
    date_trunc('day', p_started at time zone p_tz),
    date_trunc('day', p_ended at time zone p_tz),
    interval '1 day'
  ) as d
$$;

create function public.learning_daily_minutes(p_from date, p_to date) returns table(study_date date, minutes numeric)
language sql security definer set search_path='' as $$
  select sd.study_date, sum(sd.seconds)/60.0
  from learning_private.activity_segments a
  cross join lateral learning_private.segment_days(a.started_at, a.ended_at, a.timezone) sd
  where a.user_id=auth.uid() and sd.study_date between p_from and p_to
    and p_to>=p_from and p_to<=p_from+interval '366 days'
  group by sd.study_date
$$;
revoke all on function public.learning_daily_minutes(date,date) from public,anon;
grant execute on function public.learning_daily_minutes(date,date) to authenticated;
```

- [ ] **Step 5: migration 적용과 pgTAP 통과**

Run: `supabase migration up --local` 후 `supabase test db`
Expected: 전체 PASS(새 파일 포함). 실패하면 시간대 경계 계산을 다시 확인한다.

- [ ] **Step 6: DB 타입 재생성**

Run: `pnpm db:types` 후 `pnpm db:types:check`
Expected: `Database types match the local schema.`, `packages/shared/src/database.types.ts`의 `Functions`에 `learning_daily_minutes` 포함.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261002000000_learning_daily_minutes.sql supabase/tests/learning_daily_minutes.test.sql packages/shared/src/database.types.ts
git commit -m "feat(db): aggregate learning room activity into local-day minutes"
```

---

### Task 2: 통계에 학습실 시간 병합

**Files:**
- Modify: `apps/web/src/lib/statistics.ts`
- Modify: `apps/web/src/lib/statistics-api.ts`
- Test: `tests/statistics.test.mjs`
- Test: `tests/statistics-api.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `rpc/learning_daily_minutes` (`{study_date, minutes}[]`).
- Produces: `export interface DailyMetrics extends StatisticsMetrics { date: string; learningMinutes: number }`, `export interface SummaryMetrics extends StatisticsMetrics { learningMinutes: number }`, `StatisticsData.days: DailyMetrics[]`, `StatisticsData.summary: SummaryMetrics`, `buildStatistics(input: {..., learningMinutesByDay?: Readonly<Record<string, number>>})`. Task 3이 `DailyMetrics`를 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/statistics.test.mjs`의 21행을 교체한다:

```js
  assert.deepEqual(result.summary, { learningPages: 15, reviewPages: 10, recordedMinutes: 5, events: 3, timedEvents: 2, untimedEvents: 1, activeDays: 2, minutesPerPage: 0.5, learningMinutes: 0 });
```

파일 끝에 추가:

```js
test('learning room minutes merge per day and sum into the summary without touching resources', () => {
  const result = buildStatistics(input([], { learningMinutesByDay: { '2026-09-11': 12, '2026-09-13': 8 } }));
  assert.deepEqual(result.days.map(d => d.learningMinutes), [12, 0, 8]);
  assert.equal(result.summary.learningMinutes, 20);
  assert.equal(result.resources.length, 0);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/statistics.test.mjs`
Expected: FAIL (`learningMinutesByDay` 관련 프로퍼티 없음, deepEqual 불일치).

- [ ] **Step 3: `statistics.ts` 수정**

`apps/web/src/lib/statistics.ts` 전체를 다음으로 교체한다:

```ts
import { addDays } from '@paceon/scheduler';
import type { ProgressEvent, Resource } from '@paceon/shared';
import { projectProgress, ProgressError } from './progress.ts';

export interface StatisticsMetrics {
  learningPages: number;
  reviewPages: number;
  recordedMinutes: number;
  events: number;
  timedEvents: number;
  untimedEvents: number;
  activeDays: number;
  minutesPerPage: number | null;
}
export interface DailyMetrics extends StatisticsMetrics {
  date: string;
  learningMinutes: number;
}
export interface SummaryMetrics extends StatisticsMetrics {
  learningMinutes: number;
}
export interface StatisticsData {
  from: string;
  to: string;
  today: string;
  timezone: string;
  summary: SummaryMetrics;
  days: DailyMetrics[];
  resources: (StatisticsMetrics & { id: string; title: string; source: string })[];
}

export function statisticsRange(from: string | undefined, to: string | undefined, today: string) {
  const end = to ?? today;
  const start = from ?? addDays(end, -29);
  if (addDays(start, 0) !== start || addDays(end, 0) !== end || start > end || end > today || end > addDays(start, 365))
    throw new RangeError('오늘까지의 날짜를 최대 366일 범위로 선택해 주세요.');
  return { from: start, to: end };
}

function metrics(events: readonly ProgressEvent[]): StatisticsMetrics {
  const result: StatisticsMetrics = { learningPages: 0, reviewPages: 0, recordedMinutes: 0, events: events.length, timedEvents: 0, untimedEvents: 0, activeDays: new Set(events.map(event => event.study_date)).size, minutesPerPage: null };
  let speedMinutes = 0;
  let speedPages = 0;
  for (const event of events) {
    if (event.event_type === 'LEARNING') result.learningPages += event.completed_workload;
    else result.reviewPages += event.completed_workload;
    if (event.duration_minutes === null) result.untimedEvents++;
    else {
      result.timedEvents++;
      result.recordedMinutes += event.duration_minutes;
      if (event.event_type === 'LEARNING' && event.duration_minutes > 0 && event.completed_workload > 0) {
        speedMinutes += event.duration_minutes;
        speedPages += event.completed_workload;
      }
    }
  }
  result.minutesPerPage = speedPages ? speedMinutes / speedPages : null;
  return result;
}

export function buildStatistics(input: {
  resources: readonly Resource[];
  events: readonly ProgressEvent[];
  from: string;
  to: string;
  today: string;
  timezone: string;
  learningMinutesByDay?: Readonly<Record<string, number>>;
}): StatisticsData {
  const { from, to } = statisticsRange(input.from, input.to, input.today);
  const learningMinutesByDay = input.learningMinutesByDay ?? {};
  const histories = new Map<string, ProgressEvent[]>();
  for (const event of input.events) {
    const history = histories.get(event.resource_id) ?? [];
    history.push(event);
    histories.set(event.resource_id, history);
  }
  const selected: ProgressEvent[] = [];
  const resources: StatisticsData['resources'] = [];
  for (const resource of input.resources) {
    if (resource.type !== 'BOOK' || resource.workload_unit !== 'PAGE') continue;
    // Resolve VOID against the complete history before applying the date window.
    const events = projectProgress(resource, histories.get(resource.id) ?? []).activeEvents.filter(event =>
      (event.event_type === 'LEARNING' || event.event_type === 'REVIEW') && event.study_date >= from && event.study_date <= to);
    for (const event of events) {
      if (event.event_type === 'REVIEW' && (!Number.isSafeInteger(event.start_page) || !Number.isSafeInteger(event.end_page)
        || event.start_page! < 1 || event.end_page! < event.start_page! || event.end_page! > resource.total_pages!
        || event.completed_workload !== event.end_page! - event.start_page! + 1))
        throw new ProgressError('복습 기록의 페이지 범위가 올바르지 않습니다.', 'CORRUPT_PROGRESS');
    }
    selected.push(...events);
    if (events.length) resources.push({ id: resource.id, title: resource.title, source: resource.source, ...metrics(events) });
  }
  const dates = new Map<string, ProgressEvent[]>();
  for (const event of selected) {
    const day = dates.get(event.study_date) ?? [];
    day.push(event);
    dates.set(event.study_date, day);
  }
  const days: DailyMetrics[] = [];
  for (let date = from; date <= to; date = addDays(date, 1))
    days.push({ date, learningMinutes: learningMinutesByDay[date] ?? 0, ...metrics(dates.get(date) ?? []) });
  resources.sort((a, b) => b.learningPages - a.learningPages || a.id.localeCompare(b.id));
  const summary: SummaryMetrics = { learningMinutes: days.reduce((sum, day) => sum + day.learningMinutes, 0), ...metrics(selected) };
  return { from, to, today: input.today, timezone: input.timezone, summary, days, resources };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test tests/statistics.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: `statistics-api.test.mjs`에 실패하는 테스트 작성**

파일 끝에 추가:

```js
test('learning room minutes merge into every day and the summary, requested for the full range regardless of resourceId', async () => {
  const calls = [];
  const GET = createStatisticsHandler(config, async (url, init) => {
    url = new URL(url);
    if (url.pathname.endsWith('/user')) return Response.json({ id });
    if (url.pathname.endsWith('/learner_profiles')) return Response.json([{ timezone: 'Asia/Seoul' }]);
    if (url.pathname.endsWith('/resources')) return Response.json([{ id, title: 'Book', source: 'MANUAL', type: 'BOOK', workload_unit: 'PAGE', total_pages: 100, initial_completed_workload: 10 }]);
    if (url.pathname.endsWith('/progress_events')) return Response.json([]);
    if (url.pathname.endsWith('/rpc/learning_daily_minutes')) {
      calls.push(JSON.parse(init.body));
      return Response.json([{ study_date: '2026-09-12', minutes: 45.4 }, { study_date: '2026-09-13', minutes: 10 }]);
    }
    return Response.json([]);
  }, () => new Date('2026-09-12T16:00:00Z'));
  const request = query => new Request(`http://localhost/api/statistics${query ?? ''}`, { headers: { authorization: 'Bearer user-token' } });
  const data = await (await GET(request(`?resourceId=${id}`))).json();
  assert.deepEqual(calls[0], { p_from: '2026-08-15', p_to: '2026-09-13' });
  assert.equal(data.days.find(d => d.date === '2026-09-12').learningMinutes, 45);
  assert.equal(data.days.find(d => d.date === '2026-09-13').learningMinutes, 10);
  assert.equal(data.summary.learningMinutes, 55);
});
test('learning room minutes fetch failure fails the whole request with 503', async () => {
  const GET = createStatisticsHandler(config, async (url) => {
    url = new URL(url);
    if (url.pathname.endsWith('/user')) return Response.json({ id });
    if (url.pathname.endsWith('/learner_profiles')) return Response.json([]);
    if (url.pathname.endsWith('/resources')) return Response.json([]);
    if (url.pathname.endsWith('/rpc/learning_daily_minutes')) return Response.json({ message: 'down' }, { status: 500 });
    return Response.json([]);
  }, () => new Date('2026-09-12T16:00:00Z'));
  const response = await GET(new Request('http://localhost/api/statistics', { headers: { authorization: 'Bearer user-token' } }));
  assert.equal(response.status, 503);
});
```

- [ ] **Step 6: 실패 확인**

Run: `node --test tests/statistics-api.test.mjs`
Expected: FAIL (`data.summary.learningMinutes` undefined, 두 번째 테스트는 200으로 통과해 실패).

- [ ] **Step 7: `statistics-api.ts` 수정**

`apps/web/src/lib/statistics-api.ts` 전체를 다음으로 교체한다:

```ts
import { z } from 'zod';
import { toStudyDate } from '@paceon/scheduler';
import type { LearnerProfile, ProgressEvent, Resource } from '@paceon/shared';
import { ApiError, failure, json } from './books-api.ts';
import type { Config } from './books-api.ts';
import { createWorkspaceHandlers } from './workspace-api.ts';
import { buildStatistics, statisticsRange } from './statistics.ts';
import { ProgressError } from './progress.ts';

const querySchema = z.object({ from: z.string().optional(), to: z.string().optional(), resourceId: z.uuid().optional() }).strict();

export function createStatisticsHandler(config: Config | undefined, fetcher: typeof fetch = globalThis.fetch, clock: () => Date = () => new Date()) {
  const workspace = createWorkspaceHandlers(config, fetcher);
  async function dailyMinutes(auth: Awaited<ReturnType<typeof workspace.authenticate>>, from: string, to: string): Promise<Record<string, number>> {
    let rows: unknown;
    try {
      rows = await workspace.rest(auth, 'rpc/learning_daily_minutes', {}, { p_from: from, p_to: to });
    } catch {
      throw new ApiError(503, '학습실 기록을 불러오지 못했어요. 같은 요청으로 다시 시도해 주세요.');
    }
    if (!Array.isArray(rows)) throw new ApiError(503, '학습실 기록을 불러오지 못했어요. 같은 요청으로 다시 시도해 주세요.');
    const result: Record<string, number> = {};
    for (const row of rows as { study_date?: unknown; minutes?: unknown }[]) {
      if (typeof row.study_date === 'string' && typeof row.minutes === 'number') result[row.study_date] = Math.round(row.minutes);
    }
    return result;
  }
  return async (request: Request): Promise<Response> => {
    try {
      const auth = await workspace.authenticate(request);
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new ApiError(400, '조회 조건을 확인해 주세요.');
      const query = querySchema.parse(Object.fromEntries(params));
      const profiles = await workspace.rows<LearnerProfile>(auth, 'learner_profiles', { order: 'user_id.asc' });
      const timezone = profiles[0]?.timezone ?? 'Asia/Seoul';
      const today = toStudyDate(clock().toISOString(), timezone);
      const range = statisticsRange(query.from, query.to, today);
      const resources = await workspace.rows<Resource>(auth, 'resources', {
        type: 'eq.BOOK', workload_unit: 'eq.PAGE', ...(query.resourceId ? { id: `eq.${query.resourceId}` } : {}),
      });
      if (query.resourceId && !resources.length) throw new ApiError(404, '자료를 찾을 수 없습니다.');
      // Full history is required: a later VOID can invalidate an earlier selected record.
      // Room minutes reflect the whole account regardless of resourceId: learning workspaces are not tied to a book.
      const [events, learningMinutesByDay] = await Promise.all([
        resources.length ? workspace.rows<ProgressEvent>(auth, 'progress_events', {
          ...(query.resourceId ? { resource_id: `eq.${query.resourceId}` } : {}),
        }) : Promise.resolve([]),
        dailyMinutes(auth, range.from, range.to),
      ]);
      return json(buildStatistics({ resources, events, learningMinutesByDay, ...range, today, timezone }));
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof RangeError) return json({ error: '오늘까지의 날짜를 최대 366일 범위로 선택해 주세요.' }, 400);
      if (error instanceof ProgressError) return json({ error: '학습 기록이 일치하지 않아 통계를 계산하지 못했어요. 자료의 기록을 확인해 주세요.' }, 409);
      return failure(error);
    }
  };
}
```

- [ ] **Step 8: 전체 통과 확인**

Run: `node --test tests/statistics.test.mjs tests/statistics-api.test.mjs` 후 `pnpm typecheck`
Expected: PASS. typecheck는 web 전체를 검사하므로 이 태스크의 변경과 무관한 오류가 없는지도 함께 확인한다.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/statistics.ts apps/web/src/lib/statistics-api.ts tests/statistics.test.mjs tests/statistics-api.test.mjs
git commit -m "feat(api): merge learning room minutes into statistics"
```

---

### Task 3: 잔디 순수 함수

**Files:**
- Create: `apps/web/src/lib/study-heatmap.ts`
- Test: `tests/study-heatmap.test.mjs`

**Interfaces:**
- Consumes: `DailyMetrics` from `./statistics.ts` (Task 2) — `{ date: string; learningMinutes: number; recordedMinutes: number; untimedEvents: number; ... }`.
- Produces: `export type HeatmapDay = { date: string; minutes: number; level: 0|1|2|3|4 }`, `heatmapLevel(minutes: number, untimedEvents: number): 0|1|2|3|4`, `buildHeatmap(days: readonly DailyMetrics[]): HeatmapDay[]`, `computeStreak(days: readonly HeatmapDay[], today: string): { current: number; longest: number; asOf: string }`, `formatStudyDuration(minutes: number): string`. Task 4가 `HeatmapDay`를, Task 5·6이 이 파일의 함수 전부를 가져다 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

Create `tests/study-heatmap.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heatmapLevel, buildHeatmap, computeStreak, formatStudyDuration } from '../apps/web/src/lib/study-heatmap.ts';

const day = (date, learningMinutes, recordedMinutes = 0, untimedEvents = 0) => ({
  date, learningMinutes, recordedMinutes, untimedEvents,
  learningPages: 0, reviewPages: 0, events: 0, timedEvents: 0, activeDays: 0, minutesPerPage: null,
});

test('heatmap levels follow fixed minute boundaries and treat an untimed-only day as level 1', () => {
  assert.equal(heatmapLevel(0, 0), 0);
  assert.equal(heatmapLevel(0, 1), 1);
  assert.equal(heatmapLevel(14, 0), 1);
  assert.equal(heatmapLevel(15, 0), 2);
  assert.equal(heatmapLevel(29, 0), 2);
  assert.equal(heatmapLevel(30, 0), 3);
  assert.equal(heatmapLevel(59, 0), 3);
  assert.equal(heatmapLevel(60, 0), 4);
});
test('buildHeatmap sums room and book minutes per day and levels each one', () => {
  const result = buildHeatmap([day('2026-09-11', 10, 0, 0), day('2026-09-12', 0, 0, 2), day('2026-09-13', 20, 15, 0)]);
  assert.deepEqual(result, [
    { date: '2026-09-11', minutes: 10, level: 1 },
    { date: '2026-09-12', minutes: 0, level: 1 },
    { date: '2026-09-13', minutes: 35, level: 3 },
  ]);
});
test('streak counts backward from today, or from yesterday when today has no record yet, and finds the longest run', () => {
  const heat = level => ({ date: '', minutes: 0, level });
  const days = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'].map((date, i) => ({ ...heat([1, 1, 0, 1, 1][i]), date }));
  assert.deepEqual(computeStreak(days, '2026-09-13'), { current: 2, longest: 2, asOf: '2026-09-13' });
  assert.deepEqual(computeStreak(days.slice(0, 4), '2026-09-13'), { current: 1, longest: 2, asOf: '2026-09-12' });
  assert.deepEqual(computeStreak([], '2026-09-13'), { current: 0, longest: 0, asOf: '2026-09-12' });
});
test('formatStudyDuration writes hours and minutes in Korean, omitting a zero part', () => {
  assert.equal(formatStudyDuration(0), '0분');
  assert.equal(formatStudyDuration(45), '45분');
  assert.equal(formatStudyDuration(60), '1시간');
  assert.equal(formatStudyDuration(90), '1시간 30분');
  assert.equal(formatStudyDuration(125.6), '2시간 6분');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/study-heatmap.test.mjs`
Expected: FAIL (`Cannot find module '../apps/web/src/lib/study-heatmap.ts'`).

- [ ] **Step 3: 구현**

Create `apps/web/src/lib/study-heatmap.ts`:

```ts
import { addDays } from '@paceon/scheduler';
import type { DailyMetrics } from './statistics.ts';

export type HeatmapDay = { date: string; minutes: number; level: 0 | 1 | 2 | 3 | 4 };

/** 0 기록없음, 1 15분 미만 또는 시간 미입력만 있음, 2 15-29분, 3 30-59분, 4 60분 이상. */
export function heatmapLevel(minutes: number, untimedEvents: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes <= 0) return untimedEvents > 0 ? 1 : 0;
  if (minutes < 15) return 1;
  if (minutes < 30) return 2;
  if (minutes < 60) return 3;
  return 4;
}

export function buildHeatmap(days: readonly DailyMetrics[]): HeatmapDay[] {
  return days.map(day => {
    const minutes = day.learningMinutes + day.recordedMinutes;
    return { date: day.date, minutes, level: heatmapLevel(minutes, day.untimedEvents) };
  });
}

/** level>0인 날만 "학습한 날"로 센다(시간 미입력만 있어 level=1인 날 포함). */
export function computeStreak(days: readonly HeatmapDay[], today: string): { current: number; longest: number; asOf: string } {
  let longest = 0;
  let running = 0;
  for (const day of days) {
    running = day.level > 0 ? running + 1 : 0;
    if (running > longest) longest = running;
  }
  const byDate = new Map(days.map(day => [day.date, day]));
  const asOf = (byDate.get(today)?.level ?? 0) > 0 ? today : addDays(today, -1);
  let current = 0;
  for (let date = asOf; (byDate.get(date)?.level ?? 0) > 0; date = addDays(date, -1)) current++;
  return { current, longest, asOf };
}

/** 1년 합계 전용 "H시간 M분" 포맷. 짧은 기간용 "{분}분" 표기, 타이머용 MM:SS(learningDuration)와는 별개다. */
export function formatStudyDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/study-heatmap.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/study-heatmap.ts tests/study-heatmap.test.mjs
git commit -m "feat(web): add study heatmap level, streak and duration helpers"
```

---

### Task 4: 잔디 그래프 컴포넌트

**Files:**
- Create: `apps/web/src/components/study-heatmap.tsx`

**Interfaces:**
- Consumes: `HeatmapDay` from `@/lib/study-heatmap` (Task 3).
- Produces: `export function StudyHeatmap({ days, weeks, onSelectDay }: { days: readonly HeatmapDay[]; weeks?: number; onSelectDay?: (day: HeatmapDay) => void }): JSX.Element | null`. Task 5·6이 `./study-heatmap`(상대 경로)로 가져다 쓴다.

컴포넌트 렌더링 자동 테스트는 이 저장소 관례상 두지 않는다(`speech-panel.tsx` 등 기존 UI 컴포넌트와 동일). typecheck·lint로 정적 검증하고, Task 7에서 브라우저로 최종 확인한다.

- [ ] **Step 1: 구현**

Create `apps/web/src/components/study-heatmap.tsx`:

```tsx
'use client';
import { useEffect, useRef } from 'react';
import type { HeatmapDay } from '@/lib/study-heatmap';

const LEVEL_CLASS = ['bg-muted', 'bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'] as const;
const WEEKDAY_LABEL = ['월', '', '수', '', '금', '', ''] as const;

function mondayIndex(date: string): number {
  // 0=월..6=일. 날짜 문자열을 UTC 자정으로 해석해 요일만 뽑아낸다(시간대 변환 없음).
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function StudyHeatmap({ days, weeks, onSelectDay }: {
  days: readonly HeatmapDay[];
  weeks?: number;
  onSelectDay?: (day: HeatmapDay) => void;
}) {
  const visible = weeks ? days.slice(-weeks * 7) : days;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [visible.length]);
  if (!visible.length) return null;
  const leadingBlanks = mondayIndex(visible[0]!.date);
  const cells: (HeatmapDay | null)[] = [...Array.from({ length: leadingBlanks }, () => null), ...visible];
  const weekCount = Math.ceil(cells.length / 7);
  const columns: (HeatmapDay | null)[][] = Array.from({ length: weekCount }, (_, week) => cells.slice(week * 7, week * 7 + 7));
  const monthLabel = (column: (HeatmapDay | null)[]) => {
    const firstOfMonth = column.find((day): day is HeatmapDay => day !== null && Number(day.date.slice(8, 10)) <= 7);
    return firstOfMonth ? `${Number(firstOfMonth.date.slice(5, 7))}월` : '';
  };

  return (
    <div className="space-y-2">
      <div ref={scrollRef} className="flex gap-1 overflow-x-auto pb-1">
        <div className="grid shrink-0 grid-rows-7 gap-1 pt-4 text-[10px] text-muted-foreground">
          {WEEKDAY_LABEL.map((label, row) => <span key={row} className="flex h-3 items-center">{label}</span>)}
        </div>
        <div className="grid grid-flow-col gap-1">
          {columns.map((column, weekIndex) => (
            <div key={weekIndex} className="space-y-1">
              <div className="h-3 text-[10px] text-muted-foreground">{monthLabel(column)}</div>
              <div className="grid grid-rows-7 gap-1">
                {column.map((cell, row) =>
                  cell ? (
                    onSelectDay ? (
                      <button
                        key={cell.date}
                        type="button"
                        onClick={() => onSelectDay(cell)}
                        aria-label={`${cell.date} · ${cell.minutes}분`}
                        title={`${cell.date} · ${cell.minutes}분`}
                        className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[cell.level]}`}
                      />
                    ) : (
                      <span
                        key={cell.date}
                        aria-label={`${cell.date} · ${cell.minutes}분`}
                        title={`${cell.date} · ${cell.minutes}분`}
                        className={`h-3 w-3 rounded-sm ${LEVEL_CLASS[cell.level]}`}
                      />
                    )
                  ) : (
                    <span key={`blank-${weekIndex}-${row}`} className="h-3 w-3" aria-hidden="true" />
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>적음</span>
        {LEVEL_CLASS.map((cls, level) => <span key={level} className={`h-3 w-3 rounded-sm ${cls}`} aria-hidden="true" />)}
        <span>많음</span>
        <span>· 0 / &lt;15 / 15–29 / 30–59 / 60분+</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 정적 검증**

Run: `pnpm typecheck` 후 `pnpm lint`
Expected: 둘 다 오류 없음.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/study-heatmap.tsx
git commit -m "feat(web): add StudyHeatmap grid component"
```

---

### Task 5: 통계 화면에 1년 잔디 통합

**Files:**
- Modify: `apps/web/src/components/statistics-view.tsx`

**Interfaces:**
- Consumes: `StudyHeatmap` (Task 4), `buildHeatmap`·`computeStreak`·`formatStudyDuration`·`HeatmapDay` (Task 3), `StatisticsData`(Task 2).

- [ ] **Step 1: import 추가와 1년 데이터 훅**

`apps/web/src/components/statistics-view.tsx` 4행의 `import { addDays } from '@paceon/scheduler';` 다음 줄에 추가:

```tsx
import { buildHeatmap, computeStreak, formatStudyDuration, type HeatmapDay } from '@/lib/study-heatmap';
import { StudyHeatmap } from './study-heatmap';
```

`StatisticsContent` 함수 안, 기존 통계 fetch `useEffect`(46-78행) 바로 다음에 추가:

```tsx
  const [heatmap, setHeatmap] = useState<{ key: string; data: StatisticsData | null; error: string | null } | null>(null);
  const heatmapKey = `${session?.user.id ?? ''}:${context?.today ?? ''}:${revision}`;
  useEffect(() => {
    if (!session || !context) return;
    const controller = new AbortController();
    void apiFetch(`/api/statistics?from=${addDays(context.today, -365)}&to=${context.today}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '학습 잔디를 불러오지 못했어요.');
        if (!controller.signal.aborted) setHeatmap({ key: heatmapKey, data: body as StatisticsData, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setHeatmap({
            key: heatmapKey,
            data: null,
            error: error instanceof Error && !(error instanceof TypeError) ? error.message : '연결을 확인하고 다시 시도해 주세요.',
          });
      });
    return () => controller.abort();
  }, [apiFetch, session, context, heatmapKey]);
  const currentHeatmap = heatmap?.key === heatmapKey ? heatmap : null;
```

- [ ] **Step 2: 1년 그래프 섹션 렌더링**

`return (` 블록에서 `<section aria-label="통계 기간 선택"` 바로 앞에 추가:

```tsx
      <section aria-labelledby="study-heatmap-heading" className="space-y-3 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 id="study-heatmap-heading" className="font-semibold">
          최근 1년 학습 잔디
        </h2>
        {!currentHeatmap ? (
          <Skeleton className="h-24 w-full" />
        ) : currentHeatmap.error ? (
          <p role="alert" className="text-sm text-danger">
            {currentHeatmap.error}
          </p>
        ) : currentHeatmap.data ? (
          <StudyHeatmapSection data={currentHeatmap.data} />
        ) : null}
      </section>
```

`StatisticsContent` 함수 닫는 `}` 다음, `function Loading()` 앞에 새 컴포넌트를 추가:

```tsx
function StudyHeatmapSection({ data }: { data: StatisticsData }) {
  const [selected, setSelected] = useState<HeatmapDay | null>(null);
  const heatmapDays = buildHeatmap(data.days);
  // buildStatistics의 summary.activeDays는 도서 기록 기준이라 학습실만 있는 날을 놓친다.
  const activeDays = heatmapDays.filter((day) => day.level > 0).length;
  const streak = computeStreak(heatmapDays, data.today);
  const totalMinutes = data.summary.learningMinutes + data.summary.recordedMinutes;
  const detail = selected ? data.days.find((day) => day.date === selected.date) : null;
  return (
    <>
      <p className="text-sm text-muted-foreground">
        최근 1년 {formatStudyDuration(totalMinutes)} · 학습한 날 {activeDays}일 · 연속 {streak.current}일 · 최장 연속{' '}
        {streak.longest}일
      </p>
      <StudyHeatmap days={heatmapDays} onSelectDay={setSelected} />
      {detail && (
        <p role="status" className="text-sm">
          <time dateTime={detail.date}>{detail.date}</time> · {formatStudyDuration(detail.learningMinutes + detail.recordedMinutes)}
          {detail.learningMinutes || detail.recordedMinutes
            ? ` · 도서 ${detail.recordedMinutes}분 · 학습실 ${detail.learningMinutes}분`
            : ' · 기록 없음'}
        </p>
      )}
    </>
  );
}
```

- [ ] **Step 3: 날짜별 표에 학습실 열 추가**

`<th scope="col" className="p-3 text-right">기록 시간</th>` 다음(`시간 미입력` 앞)에 추가:

```tsx
                <th scope="col" className="p-3 text-right">
                  학습실
                </th>
```

같은 표의 `<td className="p-3 text-right">{number.format(day.recordedMinutes)}분</td>` 다음(시간 미입력 `<td>` 앞)에 추가:

```tsx
                  <td className="p-3 text-right">
                    {number.format(day.learningMinutes)}분
                  </td>
```

`<caption className="sr-only">`의 문구 "날짜별 학습과 복습 분량, 입력된 시간, 시간 미입력 건수"를 "날짜별 학습과 복습 분량, 입력된 시간, 학습실 시간, 시간 미입력 건수"로 바꾼다.

- [ ] **Step 4: 검증**

Run: `pnpm typecheck` 후 `pnpm lint` 후 `pnpm test`
Expected: 모두 통과(이 태스크는 로직 변경이 없으므로 기존 테스트 결과가 그대로 유지된다).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/statistics-view.tsx
git commit -m "feat(web): show the yearly study heatmap and room minutes on Statistics"
```

---

### Task 6: 오늘 화면에 12주 요약 카드 통합

**Files:**
- Modify: `apps/web/src/components/today-view.tsx`

**Interfaces:**
- Consumes: `StudyHeatmap`(Task 4), `buildHeatmap`·`computeStreak`(Task 3), `StatisticsData`(Task 2), `useAuth`(기존 `./auth-provider`), `data.today`(기존 `useWorkspace()`).

- [ ] **Step 1: import 추가**

`apps/web/src/components/today-view.tsx` 최상단 import 블록을 다음으로 교체한다(전체 교체, 새 항목 추가):

```tsx
'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Plus,
  Sunrise,
} from 'lucide-react';
import { addDays } from '@paceon/scheduler';
import {
  useWorkspace,
  WorkspaceLoading,
  WorkspaceError,
} from './workspace-data';
import { useAuth } from './auth-provider';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { SessionCard } from './session-card';
import { StudyHeatmap } from './study-heatmap';
import { formatDate } from '@/lib/planning';
import { buildHeatmap, computeStreak } from '@/lib/study-heatmap';
import type { StatisticsData } from '@/lib/statistics';
import { RecordButton } from './quick-record';
```

- [ ] **Step 2: 카드 추가**

`<aside className="space-y-5">` 안, `나의 서재` `<section>`이 끝나는 `</section>` 다음(`꾸준함을 위한 여유` `<section>` 앞)에 추가:

```tsx
          <StudyStreakCard today={data.today} />
```

파일 끝, `export function TodayView() { ... }` 다음에 새 함수를 추가한다(파일의 마지막 `}` 뒤):

```tsx
function StudyStreakCard({ today }: { today: string }) {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<{ data: StatisticsData; error: null } | { data: null; error: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`/api/statistics?from=${addDays(today, -365)}&to=${today}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '학습 기록을 불러오지 못했어요.');
        if (!controller.signal.aborted) setState({ data: body as StatisticsData, error: null });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            data: null,
            error: error instanceof Error && !(error instanceof TypeError) ? error.message : '연결을 확인하고 다시 시도해 주세요.',
          });
      });
    return () => controller.abort();
  }, [apiFetch, today]);
  if (!state) return <Skeleton className="h-40 w-full" />;
  // 조용한 카드: 이 위젯이 실패해도 오늘 화면의 나머지 기능은 그대로 동작한다.
  if (state.error || !state.data) return null;
  const heatmapDays = buildHeatmap(state.data.days);
  const streak = computeStreak(heatmapDays, today);
  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <p className="text-sm text-muted-foreground">학습 잔디</p>
      <p className="mt-3 text-3xl font-semibold tabular-nums">
        {streak.current}
        <span className="ml-1 text-base font-normal text-muted-foreground">
          일 연속{streak.asOf !== today ? ' · 어제까지' : ''}
        </span>
      </p>
      <div className="mt-4">
        <StudyHeatmap days={heatmapDays} weeks={12} />
      </div>
      <Link
        href="/statistics"
        className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary"
      >
        통계에서 1년 전체 보기
        <ArrowRight size={15} />
      </Link>
    </section>
  );
}
```

- [ ] **Step 3: 검증**

Run: `pnpm typecheck` 후 `pnpm lint` 후 `pnpm test`
Expected: 모두 통과.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/today-view.tsx
git commit -m "feat(web): add a 12-week study streak card to Today"
```

---

### Task 7: 통합 테스트, 문서, 최종 검증

**Files:**
- Modify: `tests/statistics-integration.test.mjs`
- Modify: `docs/STATISTICS.md`

- [ ] **Step 1: 통합 테스트 수정**

`tests/statistics-integration.test.mjs` 79행의 `assert.deepEqual(stats.summary, {...})`에 `learningMinutes: 0`을 추가한다:

```js
    assert.deepEqual(stats.summary, { learningPages: 5, reviewPages: 5, recordedMinutes: 3, events: 2, timedEvents: 1, untimedEvents: 1, activeDays: 1, minutesPerPage: null, learningMinutes: 0 });
```

88행(`assert.deepEqual(await read(), workspace, 'statistics never mutate progress, plans or sessions');`) 바로 다음, `} finally {` 앞에 학습실 시간이 실제로 합산되는지 확인하는 블록을 추가한다:

```js
    // A real learning-room session's settled time must show up in statistics for its local date.
    // (Midnight-crossing date math is Postgres-only and already covered by pgTAP; here we only
    // verify the live session -> settle() -> RPC -> API wiring for the common same-day case.)
    const workspaceId = randomUUID();
    const deviceId = randomUUID();
    const learningCommand = (action, fields, expected = 200) =>
      data('/api/learning/commands', alice, { action, requestId: randomUUID(), ...fields }, expected);
    await learningCommand('CREATE', { workspaceId, title: 'Statistics room check', prompt: '', kind: 'WRITING' }, 201);
    let { session } = await learningCommand('START', { workspaceId, deviceId, timezone: 'Asia/Seoul' });
    const back = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const patch = await fetch(new URL(`/rest/v1/learning_sessions?id=eq.${session.id}`, base), {
      method: 'PATCH',
      headers: { apikey: config.SERVICE_ROLE_KEY, Authorization: `Bearer ${config.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ last_seen_at: back, last_activity_at: back }),
      signal: AbortSignal.timeout(10000),
    });
    assert.ok(patch.ok, 'backdate the session for settle() to accumulate elapsed time');
    ({ session } = await learningCommand('HEARTBEAT', { sessionId: session.id, deviceId, generation: session.generation, activity: true }));
    assert.ok(session.elapsed_seconds >= 1190 && session.elapsed_seconds <= 1210, `server settled about 20 minutes (got ${session.elapsed_seconds}s)`);
    const withRoom = await data(`/api/statistics?from=${today}&to=${today}`, alice);
    const roomToday = withRoom.days.find((day) => day.date === today);
    assert.ok(roomToday, 'today is inside the requested single-day range');
    assert.ok(Math.abs(roomToday.learningMinutes - 20) <= 1, `today's room minutes reflect the settled session (got ${roomToday.learningMinutes})`);
    assert.equal(withRoom.summary.learningMinutes, roomToday.learningMinutes);
    await learningCommand('END', { sessionId: session.id, deviceId, generation: session.generation, activity: false });
```

- [ ] **Step 2: 통합 테스트 실행**

Run: `pnpm build` 후 `pnpm test:statistics:integration`
Expected: PASS. Supabase Local이 꺼져 있으면 먼저 `supabase start`.

- [ ] **Step 3: 문서 갱신**

`docs/STATISTICS.md`의 `## 지표` 표 다음, `정정 또는 무효 처리된...` 문단 앞에 새 절을 추가한다:

```markdown
## 학습 잔디

메뉴의 **통계** 맨 위와 **오늘** 화면에 하루 학습 시간(도서 기록 분 + 학습실 시간)을 색 진하기로 보여주는 달력형 그래프를 표시한다. 통계 화면은 항상 최근 1년, 오늘 화면은 최근 12주만 보여주며 기간 선택과 무관하다.

색 단계는 고정 기준이다: 기록 없음, 15분 미만(또는 시간 미입력 도서 기록만 있음), 15–29분, 30–59분, 60분 이상. 학습실 시간은 학습실 세션의 실제 경과 시간을 세션이 시작된 시점에 저장된 사용자 시간대의 지역 날짜로 나눠 합산한다. 시간대를 나중에 바꿔도 이미 기록된 구간의 날짜 배정은 바뀌지 않는다.

연속 학습일은 최근 1년 안에서 계산한다. 오늘 아직 기록이 없으면 어제까지 이어진 연속일을 보여준다. 자정을 넘긴 학습실 세션은 실제 경과 시간을 두 날짜에 걸쳐 정확히 나눈다.
```

기존 `## API와 데이터 경계` 절의 첫 문단 끝에 문장을 추가한다:

```markdown
학습실 시간은 `resourceId` 필터와 무관하게 항상 전체 계정 기준으로 합산되며, `rpc/learning_daily_minutes` 호출이 실패하면 응답 전체가 503이다.
```

`## 검증` 절의 `pnpm test:statistics:integration` 설명 문장 끝에 추가:

```markdown
실제 학습실 세션의 경과 시간이 통계에 반영되는지도 함께 확인한다.
```

- [ ] **Step 4: 전체 검증**

Run:
```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
supabase test db
pnpm db:types:check
```
Expected: 모두 PASS.

- [ ] **Step 5: 브라우저 확인**

Run: `pnpm dev`, 로그인 후 확인:

- `/statistics` 맨 위에 1년 잔디, 범례, 요약 한 줄이 보인다. 칸을 누르면 아래에 그날 상세(도서/학습실 분)가 뜬다.
- 날짜별 표에 "학습실" 열이 추가되어 있다.
- `/today`의 사이드바에 "학습 잔디" 카드가 12주 그래프와 "N일 연속"을 보여준다. "통계에서 1년 전체 보기"를 누르면 `/statistics`로 이동한다.
- 학습실에서 실제로 학습 시간을 조금 쌓은 뒤 두 화면 모두 새로고침해 해당 날짜 칸이 진해지는지 확인한다.
- 390px 모바일 너비에서 잔디 그래프만 가로로 스크롤되고(처음에 오늘 쪽이 보임) 페이지 전체는 가로 스크롤되지 않는다.

- [ ] **Step 6: Commit**

```bash
git add tests/statistics-integration.test.mjs docs/STATISTICS.md
git commit -m "test,docs: cover live room-time wiring and document the study heatmap"
```
