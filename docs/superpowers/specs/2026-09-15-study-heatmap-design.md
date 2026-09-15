# 학습 잔디(히트맵) 설계

작성일: 2026-09-15 · 기준 커밋: `ac23463`

## 1. 목적과 범위

GitHub의 Contribution Graph처럼, 하루 학습량을 색 진하기로 보여주는 달력형 그래프(잔디)를 추가한다. 도서 기록과 학습실(리스닝·스피킹·라이팅) 시간을 합쳐 "얼마나 학습하고 있는지"를 한눈에 보여준다.

**포함**

- 하루 칸의 색은 그날의 총 학습 시간(도서 기록 분 + 학습실 시간)으로 정한다.
- 통계 화면(`/statistics`) 맨 위에 최근 1년 전체 그래프를 둔다.
- 오늘 화면(`/today`)에 최근 12주 요약 카드와 연속 학습일을 둔다.

**제외**

- 진도·계획·일정 데이터 변경. 이번 기능은 기존 기록을 읽기만 한다.
- 새 예약 작업이나 요약 테이블. [DATABASE](../../DATABASE.md), [STATISTICS](../../STATISTICS.md)와 같은 원칙으로, 정정·무효 처리는 매 조회 시 다시 계산한다.
- 잔디 공유·이미지 내보내기, 주간/월간 목표 설정.

## 2. 현재 구조 (확인한 사실)

- `GET /api/statistics`(`statistics-api.ts`)는 `learner_profiles.timezone`으로 "오늘"을 정하고, 도서 자료의 `progress_events`만 읽어 `buildStatistics`(`statistics.ts`)로 날짜별·자료별 지표를 만든다. 기간은 최대 366일, 종료일은 오늘까지다.
- 학습실 세션(`learning_sessions.elapsed_seconds`)은 `learning_private.settle` 함수가 `learning_private.activity_segments`(세션별 UTC 시작·종료·시간대 구간)의 합으로 다시 계산한다. 이 테이블은 마이그레이션 주석에 "나중에 지역 날짜 통계를 위해 남긴다"고 명시되어 있으나, 사용자 토큰으로 조회할 RPC나 REST 권한이 없다.
- `activity_segments`에는 `user_id` 단독 인덱스가 없다. 기본 키는 `(session_id, started_at)`뿐이다.
- `useWorkspace()`(`workspace-data.tsx`, `workspace-types.ts`)가 반환하는 `WorkspaceData`에 이미 `today`, `timezone`이 있어 오늘 화면은 이를 바로 쓸 수 있다.
- 통계 화면(`statistics-view.tsx`)은 마운트 시 파라미터 없이 한 번 호출해 `context.today`를 얻고, 7·30·90일 프리셋과 직접 입력으로 기간을 바꿀 때마다 다시 호출한다. 간편 기록 저장 시 `WORKSPACE_CHANGED` 이벤트로 새로고침한다.
- 차트 라이브러리는 없다(`recharts` 등 미설치). 잔디는 CSS grid로 직접 그린다.

## 3. 화면

### 3.1 공통 컴포넌트 `StudyHeatmap`

`apps/web/src/components/study-heatmap.tsx`

```ts
type HeatmapDay = { date: string; minutes: number; level: 0 | 1 | 2 | 3 | 4 };
function StudyHeatmap(props: {
  days: HeatmapDay[];       // 날짜 오름차순, 빈 날짜 없이 연속
  weeks?: number;           // 주어지면 꼬리(최근) N주만 표시
  onSelectDay?: (day: HeatmapDay) => void;
}): JSX.Element;
```

- **배치:** 가로가 주(월요일 시작 7칸), 세로가 요일. 위에 월 이름, 왼쪽에 월·수·금만 표시한다.
- **주 정렬:** `days`의 첫 날짜가 속한 주의 월요일부터 그리도록, 첫 날짜의 요일 이전 칸은 빈 칸(투명, 클릭 불가)으로 왼쪽에 채운다.
- **색 단계(고정 기준, 기간에 따라 상대적으로 바뀌지 않음):**

  | 단계 | 조건 |
  | --- | --- |
  | 0 | `minutes === 0`이고 그날 시간 미입력 기록도 없음 |
  | 1 | `0 < minutes < 15`, 또는 `minutes === 0`이고 시간 미입력 도서 기록이 있음 |
  | 2 | `15 <= minutes < 30` |
  | 3 | `30 <= minutes < 60` |
  | 4 | `minutes >= 60` |

- **범례:** "적음 ▢▢▢▢ 많음" 아래에 단계별 분 기준을 작게 표기한다.
- **칸 선택:** 칸은 `<button>`이며 `aria-label`에 "9월 14일(일) · 45분"처럼 날짜와 총 시간을 담는다. `onSelectDay`가 있으면 누른 날짜를 부모에 전달한다(그래프 자체는 상세 내용을 그리지 않는다).
- **모바일:** 그래프를 감싸는 요소만 `overflow-x: auto`이며, 최초 렌더 시 스크롤 위치를 오른쪽 끝(오늘)으로 맞춘다. 페이지 전체는 가로로 스크롤되지 않는다.

### 3.2 통계 화면 (`/statistics`)

- 헤더 아래, 기존 기간 선택 폼 **위**에 1년 그래프 섹션을 추가한다.
  - `<StudyHeatmap days={...366일...} onSelectDay={...}>`. 기간 선택(7·30·90·직접 입력)과 무관하게 항상 `[addDays(today,-365), today]`.
  - 요약 한 줄: "최근 1년 {총시간} · 학습한 날 {D}일 · 연속 {S}일 · 최장 연속 {L}일". 총시간은 §5.4의 `formatStudyDuration`으로 `H시간 M분` 형태로 표기한다(0시간이면 분만, 0분이면 "0분"). 기존 통계 표의 `{분}분` 표기(짧은 기간용)나 학습실 타이머의 `MM:SS` 표기(`learningDuration`)와는 별개의, 1년 합계 전용 새 포맷이다.
  - 칸을 선택하면 그래프 바로 아래에 "9월 14일(일) · 45분 · 도서 20분 · 학습실 25분"을 표시한다(기록 없는 날은 "기록 없음").
- 기존 날짜별 표(`statistics-daily-heading`)에 **학습실** 시간 열을 추가한다. 표시 범위는 지금처럼 선택한 기간(7·30·90·직접 입력)이며 1년 그래프와 별개다. 다른 열(새로 학습한 분량 등)은 바꾸지 않는다.

### 3.3 오늘 화면 (`/today`)

- 기존 섹션 중 적절한 위치(예: "다가오는 학습" 근처)에 요약 카드를 추가한다.
  - `<StudyHeatmap days={...366일 중 최근 12주...} weeks={12}>` (선택 불가, `onSelectDay` 없음).
  - "연속 {S}일" 큰 글씨와 "통계에서 1년 전체 보기" 링크(`/statistics`)를 함께 둔다.
  - 연속일은 1년 데이터로 계산한다. 오늘 아직 기록이 없으면 어제까지 이어진 연속일을 보여주고, 문구를 "어제까지 {S}일 연속"으로 구분한다.

## 4. 데이터

새 migration `supabase/migrations/20261002000000_learning_daily_minutes.sql`.

### 4.1 인덱스

```sql
create index activity_segments_user_started on learning_private.activity_segments(user_id, started_at);
```

### 4.2 구간을 지역 날짜별 초로 나누는 함수

```sql
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
```

구간이 시작될 때 저장된 시간대(`activity_segments.timezone`)를 기준으로 자정을 나누므로, 시간대를 나중에 바꿔도 과거 구간의 날짜 배정은 변하지 않는다. `toStudyDate`가 쓰는 것과 같은 "그 시간대의 달력 날짜" 기준이다.

### 4.3 공개 조회 함수

```sql
create function public.learning_daily_minutes(p_from date, p_to date)
returns table(study_date date, minutes numeric)
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

- `auth.uid()`로 호출한 사용자 행만 집계한다. `learning_private.activity_segments`는 PostgREST에 노출되지 않으므로 이 함수가 유일한 조회 경로다.
- 범위가 366일을 넘거나 `p_to < p_from`이면 빈 결과를 반환한다(웹 API가 이미 같은 범위를 검증하므로, DB에서는 남용 방지용 최소 장치만 둔다).
- RLS·`learning_sessions`·`settle`·기존 학습실 명령은 바꾸지 않는다.

### 4.4 pgTAP (`supabase/tests/learning_daily_minutes.test.sql`)

- 자정을 넘긴 구간(예: `23:50~00:30`, `Asia/Seoul`)이 이틀로 정확히 나뉜다.
- 서로 다른 시간대로 저장된 구간 두 개가 각자 맞는 날짜에 더해진다.
- 다른 사용자의 구간이 섞이지 않는다.
- 범위 밖 날짜의 구간은 결과에 없다.
- `p_to < p_from` 또는 366일 초과 범위는 빈 결과를 반환한다.
- 비로그인(`anon`)이나 `authenticated` 권한이 없는 role의 호출은 거부된다(`42501`).

## 5. API

`GET /api/statistics` 응답만 확장한다. 새 경로는 만들지 않는다.

### 5.1 서버 (`statistics-api.ts`)

- 기존 `resources`, `progress_events` 조회와 함께 `rpc/learning_daily_minutes`를 `{p_from: range.from, p_to: range.to}`로 호출한다.
- RPC 실패는 통계 전체를 503으로 실패시킨다(부분 성공으로 조용히 학습실 시간을 빠뜨리지 않는다).

### 5.2 순수 함수 (`statistics.ts`)

- `buildStatistics`가 `learningMinutesByDay: Record<string, number>` 입력을 추가로 받는다(날짜 → 분, RPC 결과를 `Math.round`로 정수 분으로 변환해 전달).
- 타입 변경:
  ```ts
  export interface DailyMetrics extends StatisticsMetrics { date: string; learningMinutes: number }
  export interface SummaryMetrics extends StatisticsMetrics { learningMinutes: number }
  export interface StatisticsData {
    from: string; to: string; today: string; timezone: string;
    summary: SummaryMetrics;
    days: DailyMetrics[];
    resources: (StatisticsMetrics & { id: string; title: string; source: string })[]; // 변경 없음
  }
  ```
- `resources`(책별 목록)에는 `learningMinutes`를 추가하지 않는다. 학습실 공간은 특정 책에 연결되지 않는다.
- `summary.learningMinutes`는 `days[].learningMinutes`의 합이다.

### 5.3 호출하는 쪽

- **통계 화면:** 기존 기간 호출은 그대로 두고, 1년 그래프용으로 `from=addDays(context.today,-365)&to=context.today`를 별도로 한 번 더 호출한다.
- **오늘 화면:** `useWorkspace()`의 `data.today`로 바로 `from=addDays(data.today,-365)&to=data.today`를 한 번 호출한다. 준비 요청이 필요 없다.

### 5.4 새 순수 함수 모듈 `apps/web/src/lib/study-heatmap.ts`

DB·API 없이 `DailyMetrics[]`만 입력받는다.

```ts
export function heatmapLevel(minutes: number, untimedEvents: number): 0 | 1 | 2 | 3 | 4;
// buildHeatmap: 각 날짜의 level = heatmapLevel(day.learningMinutes + day.recordedMinutes, day.untimedEvents)
export function buildHeatmap(days: DailyMetrics[]): HeatmapDay[];
// computeStreak: level>0인 날만 "학습한 날"로 센다(시간 미입력만 있어 level=1인 날 포함).
// today가 level>0이면 asOf=today부터, 아니면 전날부터 거꾸로 연속일을 센다.
export function computeStreak(days: HeatmapDay[], today: string): { current: number; longest: number; asOf: string };
// 1년 합계 전용 "H시간 M분" 포맷. 0시간이면 분만, 0분이면 "0분".
export function formatStudyDuration(minutes: number): string;
```

## 6. 테스트

| 계층 | 검증 |
| --- | --- |
| pgTAP | §4.4 전체 |
| Node 단위 (`statistics.test.mjs`) | 학습실 분이 날짜별·요약에 정확히 더해짐, 책 기록 없이 학습실만 있는 날도 집계됨, `resources`에는 `learningMinutes`가 없음 |
| Node 단위 (`statistics-api.test.mjs`) | `rpc/learning_daily_minutes` 호출 파라미터(`p_from`,`p_to`), RPC 실패 시 503, 응답에 `learningMinutes` 포함하고 개인정보 없음 |
| 순수 함수 (`study-heatmap.test.mjs`, 신규) | 단계 경계값(0, 14, 15, 29, 30, 59, 60분), 시간 미입력만 있는 날 1단계, 연속일 계산(오늘 미기록 시 전날 기준 `asOf`, 중간 공백으로 끊김, 최장 연속), `formatStudyDuration`(0분, 59분, 60분, 61분, 시간·분 경계) |
| 통합 (`statistics-integration.test.mjs`) | 실제 학습실 세션을 자정을 넘기도록 만들고, 통계 응답의 `learningMinutes`가 실제 세션 경과 시간과 일치하는지 확인 |
| 브라우저 수동 | 통계 화면 1년 그래프와 칸 선택 상세, 오늘 화면 12주 카드와 연속일, 390px에서 그래프만 가로 스크롤되고 페이지는 스크롤 안 됨 |

## 7. 구현 순서와 배포

1. DB: migration, pgTAP
2. 통계 계산: `statistics.ts` 병합, `statistics-api.ts` RPC 연결, `study-heatmap.ts`
3. 화면: `study-heatmap.tsx`, 통계 화면 통합, 오늘 화면 통합
4. 문서: `docs/STATISTICS.md`에 학습실 시간 합산 규칙과 잔디 그래프 설명 추가

- 새 테이블이나 컬럼 변경이 없고 조회 함수만 추가하므로, DB를 먼저 배포한 뒤 웹을 배포한다(웹이 먼저 나가면 그 사이 `learningMinutes`가 없는 이전 응답 형식을 받아 단순히 0으로 처리되므로 치명적이지 않지만, 순서를 지켜 이 창을 없앤다).
- 되돌리기: `learning_daily_minutes`, `segment_days` 함수와 인덱스를 지우는 migration이면 충분하다. 기존 테이블을 바꾸지 않으므로 데이터 손실이 없다.
