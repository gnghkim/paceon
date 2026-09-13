# Phase 4 — Basic UI

## 화면과 사용 순서

`/`는 `/today`로 이동한다. 로그인 전에는 개인 자료를 불러오거나 표시하지 않고 `/login`에서 이메일·비밀번호 로그인/가입을 제공한다. Supabase SDK가 세션 저장과 토큰 갱신을 담당하며, 서버 API는 매 요청의 토큰을 Auth 서버에서 검증한다. 계정이 바뀌면 입력 중이던 개인 화면 상태도 초기화한다.

1. `/resources/new`에서 Google Books로 검색하거나 직접 입력한다. 검색이 실패해도 직접 입력할 수 있다. 제목, 전체 페이지, 마지막으로 읽은 페이지를 확인해 저장한다.
2. `/resources/[id]`에서 첫 계획을 만든다. 하루 분량 유지(Pace), 목표 날짜(Deadline), 균형 조정(Balanced)을 지원한다. 시작일·목표일·분량·페이지당 예상 시간·학습 가능한 요일과 시간을 입력하고 미리보기 후 저장한다.
3. `/today`에서 오늘과 다가오는 학습 분량을 확인한다. `/resources`에서는 제목·저자 검색과 읽는 중/완독 필터를 제공한다.
4. `/calendar`는 주 보기가 기본이며 일/월 보기, 이전·다음 기간, 날짜별 일정을 제공한다. 모바일에서는 날짜 선택과 하단 일정 목록으로 읽기 쉽게 표시한다.

첫 계획은 브라우저의 시간대를 기본으로 제안하며 사용자가 바꿀 수 있다. 첫 저장 이후에는 모든 책이 같은 시간대와 주간 시간 예산을 사용한다. 추가 계획을 만들면서 기존 공통 시간을 바꾸지 않는다. 기존 계획이 차지하는 시간 때문에 요청 분량을 배정할 수 없으면 저장하지 않고 조정할 입력을 안내한다.

현재 진도는 **등록 시 진도**를 표시한다. 완료 기록·실제 진도 projection·자동 재계획·계획 수정/되돌리기는 Phase 5에서 연결한다. 존재하지 않는 기록, AI 분석, Ahead/Behind 통계를 만들지 않는다.

## API

모든 개인 데이터 endpoint는 기존 `Authorization: Bearer <access token>` 계약을 사용한다. 서비스 비밀 키를 사용하지 않으며 응답은 `no-store`다.

`GET /api/workspace?from=YYYY-MM-DD&to=YYYY-MM-DD&resourceId=UUID`

- 날짜 기본값은 사용자 시간대의 오늘 -7일 ~ +35일. 최대 93일이며 역순·잘못된 날짜는 400이다.
- `{ resources, plans, sessions, availability, timezone, today, from, to }`를 반환한다. 본인 BOOK 자료와 활성/일시정지 계획을 조회하고, 세션은 ACTIVE 계획만 표시한다.
- `resourceId`로 자료 상세를 요청하면 본인 소유가 아니거나 없는 자료는 404다. DB 페이지를 순회하여 읽으며 컬렉션별 20,000행 제한 초과 시 부분 데이터 대신 오류를 반환한다.

`POST /api/resources/books/{id}/plan`

```json
{
  "preview": true,
  "options": {
    "mode": "PACE",
    "startDate": "2026-09-14",
    "timezone": "Asia/Seoul",
    "dailyPages": 20,
    "minutesPerPage": 1.1,
    "availability": [
      { "isoWeekday": 1, "availableMinutes": 60 },
      { "isoWeekday": 3, "availableMinutes": 60 },
      { "isoWeekday": 5, "availableMinutes": 60 }
    ]
  }
}
```

`preview: true`는 서버에서 계산한 `{ schedule }`만 200으로 반환한다. `false`/생략은 재계산 후 저장하고 201 `{ planId, schedule }`을 반환한다. 지난 시작일·입력 오류 400, 없는 자료 404, 기존 계획·자료 상태 변경·용량 충돌 409, 연결 장애 503이다. 미리보기 이후 설정을 바꾸면 다시 미리 본 뒤 저장한다. 서버는 클라이언트가 보낸 일정 목록을 받지 않는다.

페이지당 시간은 0.1~1440분, 소수 셋째 자리까지다. 일정은 최대 3660일이다. 저장할 분은 페이지 수 × 입력 시간을 계산한 뒤 올림한다. JavaScript 부동소수점 오차로 50 × 1.1이 56분이 되지 않도록 정수 밀리분 계산과 PostgreSQL numeric 계산을 맞췄다.

## 최초 저장 트랜잭션

`20260914000000_initial_book_plan.sql`의 `create_initial_book_plan`은 `SECURITY INVOKER`로 RLS를 유지한다. 사용자 단위 advisory transaction lock과 자료 행 잠금으로 중복/동시 저장을 직렬화한다.

트랜잭션 안에서 소유권, 전체/현재 페이지 snapshot, 기존 계획/진도 이력, 공통 시간대/요일 예산, 세션의 날짜 순서와 남은 페이지 전체 연속성, 이미 배정된 시간과의 합계, 예상 완료일을 검증한다. 검증 후 profile/availability/goals/plans/schedule_sessions를 함께 저장한다. 한 단계라도 실패하면 전체가 취소된다. RPC를 사용하는 최초 계획 저장끼리의 동시성을 보장하며 임의의 직접 REST 편집을 재계획으로 취급하지 않는다.

## 로컬 실행과 검증

`supabase migration up --local`로 추가 migration을 적용한다. Next가 읽는 `apps/web/.env.local`에 로컬 URL/publishable key를 설정하고 `pnpm dev`를 실행한다. 실제 키는 Git에 포함하지 않는다. Supabase Local 기본 설정은 이메일 확인 없이 가입할 수 있다. 이메일 확인을 켠 환경은 Auth의 Site URL/Redirect URLs에 실제 서비스 origin 및 `/login`을 등록해야 한다.

검증 명령: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:test`, `pnpm db:types:check`, `pnpm test:books:integration`(빌드·Supabase Local 필요), `supabase db lint --local`.

통합 테스트는 실제 프로덕션 Next HTTP → Auth → RLS/RPC 저장을 검사한다. 같은 책 중복 저장, 서로 다른 책의 공통 시간 경쟁, 실패 후 불필요한 목표 행이 남지 않는지, 소수 시간 계산, 사용자 격리와 조회를 검증한다.

브라우저 수동 검증은 로컬 임시 계정에서 가입·검색 실패·수동 등록·계획 미리보기/저장·새로고침·Today/Calendar·서재 검색·로그아웃/재로그인을 수행했다. 1440px 데스크톱과 390px 모바일을 확인했고 모바일 가로 넘침과 브라우저 실행 오류는 없었다. 임시 계정과 자료는 검증 후 삭제한다.
