# PaceOn — Initial Development Prompt

우리는 새로운 웹앱 **PaceOn**을 개발한다.

브랜드 의미는 **Pace + On**, 영문 태그라인은 **Your learning, at your pace.**, 한국어 설명은 **내 속도에 맞춰 계속 다시 짜주는 학습 계획**이다.

이 프로젝트는 단순 Todo/Habit 앱이 아니다.

사용자가 책, 교재, PDF, 강의 등의 학습자료를 등록하면 전체 학습량을 분석하여 자동으로 일정을 생성하고, 실제 학습 결과에 따라 미래 일정을 지속적으로 재조정하는 **Adaptive Learning Planner**다.

반드시 `docs/PRD.md`를 제품 요구사항의 Single Source of Truth로 사용하라.

---

# 1. 핵심 제품 개념

기본 흐름은 다음과 같다.

```text
Resource
→ Resource Unit
→ Plan
→ Schedule Session
→ Progress Event
→ Evaluation
→ Replanner
```

예:

```text
책 320페이지

현재 80페이지

하루 20페이지

월~금 학습
```

이면 남은 학습량과 가능한 학습일을 계산하여 자동 일정을 생성한다.

사용자가 계획보다 많이 읽으면 완료일을 앞당기고, 계획보다 적게 읽으면 미래 일정을 재조정한다.

---

# 2. Architecture

Monorepo를 사용한다.

```text
paceon/

apps/
  web/

services/
  ai-worker/

packages/
  scheduler/
  shared/
  ai-schema/

supabase/
  migrations/
  functions/
  seed.sql

docker/
  docker-compose.yml

docs/
```

Package manager:

```text
pnpm
```

---

# 3. Frontend

사용:

```text
Next.js
TypeScript
App Router
Tailwind CSS
shadcn/ui
```

Next.js는 로컬 개발 시 Docker 안에서 실행하지 않는다.

```bash
pnpm dev
```

로 직접 실행한다.

---

# 4. Backend

Supabase를 사용한다.

담당:

```text
PostgreSQL
Auth
Storage
Realtime
Queue
Cron
RLS
```

개발 환경은 Supabase Local을 사용한다.

운영 환경에서는 Supabase Cloud를 사용한다.

---

# 5. AI Worker

별도 Python 서비스를 만든다.

```text
services/ai-worker
```

기술:

```text
Python
FastAPI
Pydantic
Docker
```

개발에서는 Docker로 실행한다.

운영 시 Hostinger VPS에 배포할 예정이다.

담당:

```text
PDF Parsing
Resource Analysis
Difficulty Estimation
Learning Evaluation
Background AI Job
```

단, 초기 단계에서는 skeleton만 만들고 모든 AI 기능을 한꺼번에 구현하지 않는다.

---

# 6. Scheduler

이 프로젝트에서 가장 중요한 모듈이다.

반드시:

```text
packages/scheduler
```

에 독립적인 TypeScript package로 구현한다.

React, Next.js, Supabase에 의존해서는 안 된다.

Pure TypeScript business logic으로 작성한다.

Scheduler는 최소한 다음 모드를 지원해야 한다.

```text
DEADLINE
PACE
BALANCED
```

---

# 7. AI와 Scheduler의 역할을 섞지 말 것

다음은 AI에게 맡기지 않는다.

```text
날짜 계산
남은 페이지 계산
진행률 계산
가능 학습일 계산
페이지 분배
일정 충돌
고정 일정 처리
```

이는 deterministic logic으로 구현한다.

AI가 판단하는 값:

```text
difficulty
importance
estimated_minutes
mastery
review_priority
confidence
```

Scheduler는 AI가 만든 이러한 값을 입력값으로 사용할 수 있다.

---

# 8. 핵심 Entity

초기에는 다음 Entity를 정의한다.

```text
User

Goal

Resource

ResourceUnit

Plan

AvailabilityRule

ScheduleSession

ProgressEvent

ReplanRun

LearnerProfile
```

Habit은 이후 추가한다.

---

# 9. Resource

Resource type:

```text
BOOK
PDF
COURSE
VIDEO
CUSTOM
```

Book Resource는 최소:

```text
title
author
isbn
publisher
total_pages
current_page
cover_url
```

를 지원한다.

---

# 10. Resource Provider

외부 API를 직접 UI나 business logic에서 호출하지 않는다.

Adapter Pattern을 사용한다.

```text
BookProvider

YES24Provider
GoogleBooksProvider
ManualProvider
```

통합 타입:

```typescript
interface BookMetadata {
  isbn?: string;
  title: string;
  authors: string[];
  publisher?: string;
  pageCount?: number;
  tableOfContents?: string;
  thumbnail?: string;
  description?: string;
}
```

---

# 11. Scheduler Example

다음 테스트가 동작해야 한다.

Input:

```text
total pages = 320

current page = 80

daily workload = 20 pages

available days =
MON
TUE
WED
THU
FRI
```

Output:

```text
remaining pages = 240

required sessions = 12

estimated completion date calculated correctly
```

Schedule Session 예:

```text
Day 1
81~100

Day 2
101~120
```

---

# 12. Replanner Example

오늘 계획:

```text
101~120
20p
```

실제:

```text
101~110
10p
```

남은:

```text
10p
```

DEADLINE:

```text
target date 유지
남은 일정에 workload 분산
```

PACE:

```text
20p/day 유지
completion date 연장
```

BALANCED:

```text
학습량 증가와 완료일 변경을 함께 사용
```

---

# 13. Progress Event

현재 페이지를 단순 overwrite하지 않는다.

학습 결과는 event로 저장한다.

예:

```text
start_page
end_page
duration_minutes
completed_at
difficulty_feedback
```

현재 progress는 event에서 계산하거나 projection 형태로 관리한다.

---

# 14. Database

Supabase migration으로 작성한다.

절대로 Dashboard에서만 수동으로 테이블을 만들지 않는다.

모든 변경사항은:

```text
supabase/migrations/
```

에 기록한다.

RLS를 초기 단계부터 적용한다.

---

# 15. Development Environment

로컬:

```text
Next.js
localhost:3000

AI Worker
localhost:8000

Supabase Local
```

Docker:

```text
Supabase
AI Worker
```

Next.js:

```text
Docker 밖에서 실행
```

---

# 16. MVP UI

우선 다음 화면만 만든다.

```text
/login

/today

/calendar

/resources

/resources/new

/resources/[id]
```

UI는 desktop/mobile responsive.

PWA-ready 구조로 작성한다.

---

# 17. UI Style

목표:

```text
calm
clean
focused
modern productivity app
```

과도한 gradient와 장식은 사용하지 않는다.

Calendar와 Progress가 중심이다.

Dashboard는 정보를 많이 보여주기보다:

```text
오늘 해야 할 것
현재 진행상태
목표 대비 앞섬/뒤처짐
```

이 잘 보이게 한다.

---

# 18. Today 화면

예:

```text
오늘 · 9월 14일

English Grammar in Use

Unit 13~14

40분

[학습 시작]


Atomic Habits

120~140p

20페이지

[완료 기록]
```

---

# 19. Resource Card

```text
Atomic Habits

142 / 320p

Progress
44%

Target
10/24

Estimated
10/18

6 days ahead
```

---

# 20. Error Handling

모든 외부 API는 실패할 수 있다고 가정한다.

예:

```text
YES24 실패
→ Google Books

Google Books 실패
→ Manual input
```

AI 실패:

```text
AI evaluation 없음
→ 기본 Scheduler 정상 작동
```

AI 서비스는 핵심 Scheduler의 hard dependency가 되어서는 안 된다.

---

# 21. Coding Rules

반드시 지켜라.

1. TypeScript strict
2. `any` 사용 최소화
3. Domain logic을 React component에 작성하지 않는다.
4. Scheduler와 UI를 분리한다.
5. External API는 Adapter Pattern.
6. Zod validation 사용.
7. 환경변수 `.env.example` 작성.
8. API Key commit 금지.
9. 날짜 DB 저장은 UTC.
10. UI는 사용자 timezone 사용.
11. DB 변경은 migration.
12. AI response는 structured output으로 제한.
13. 모든 주요 scheduler logic에는 unit test 작성.

---

# 22. Testing

최소:

```text
Vitest
```

Scheduler 테스트를 작성한다.

필수 테스트:

```text
남은 페이지 계산

Deadline schedule

Pace schedule

Balanced schedule

주말 제외

완료 Session 보존

Pinned Session 보존

미달 Progress Replan

초과 Progress Replan
```

---

# 23. 구현 순서

아래 순서를 반드시 따른다.

## Phase 0 — Foundation

- Monorepo
- Next.js
- Supabase Local
- FastAPI skeleton
- shared package
- scheduler package
- 환경변수
- README

여기까지 완료 후 테스트한다.

---

## Phase 1 — Core Domain

구현:

```text
Resource
Plan
ScheduleSession
ProgressEvent
```

DB migration 생성.

---

## Phase 2 — Scheduler Engine

AI 없이 동작하게 한다.

먼저 Pure TypeScript scheduler를 완성한다.

---

## Phase 3 — Book Resource

- Manual
- Google Books
- Adapter 구조

YES24 Provider는 interface부터 준비한다.

---

## Phase 4 — Basic UI

- Today
- Resource List
- Resource Detail
- Add Resource
- Calendar

---

## Phase 5 — Progress / Replanning

실제 진도 입력.

미달/초과 시 schedule을 재계산한다.

---

## Phase 6 — AI

이후에 추가한다.

- Resource difficulty
- estimated time
- AI Coach

PDF 분석은 이 단계 이후 구현한다.

---

# 24. 첫 번째 작업

지금은 전체 앱을 구현하지 마라.

먼저 프로젝트의 기반만 만든다.

반드시 다음을 완료한다.

```text
1. Monorepo 생성

2. apps/web
Next.js 초기화

3. packages/scheduler
TypeScript package 생성

4. packages/shared
공통 type package 생성

5. services/ai-worker
FastAPI skeleton 생성

6. Supabase local project 초기화

7. docker-compose 작성

8. .env.example 작성

9. README 작성

10. 기본 health check 구성
```

그리고 다음 명령으로 개발 환경이 실행되어야 한다.

```bash
docker compose up -d

pnpm install

pnpm dev
```

웹:

```text
http://localhost:3000
```

AI Worker:

```text
http://localhost:8000/health
```

---

# 25. 첫 작업 완료 조건

다음을 확인하라.

```text
pnpm install 성공

pnpm dev 성공

Next.js 페이지 정상

Supabase Local 정상

FastAPI health 정상

scheduler package import 정상

TypeScript error 없음
```

가능하면 build/test도 실행한다.

문제가 발생하면 임시 우회보다 원인을 수정한다.

---

# 26. 작업 방식

한 번에 너무 많은 기능을 만들지 않는다.

각 Phase마다:

```text
Implement
→ Build
→ Test
→ Verify
→ Commit-ready 상태
```

순서로 진행한다.

기존 코드가 있으면 먼저 전체 구조를 읽고 기존 패턴을 따른다.

파일을 생성하기 전에 현재 repository 구조를 확인한다.

중복 구현을 피한다.

---

# 27. Documentation

개발하면서 다음 파일을 유지한다.

```text
docs/PRD.md

docs/ARCHITECTURE.md

docs/DATABASE.md

docs/SCHEDULER.md
```

구현과 문서가 달라지면 문서도 함께 수정한다.

---

# 28. 프로젝트의 최우선 원칙

이 서비스의 핵심은 AI Chat이 아니다.

핵심은:

```text
사용자의 실제 학습행동
        ↓
현재 속도 판단
        ↓
미래 계획 재계산
```

이다.

Scheduler Engine의 정확성과 예측 가능성을 최우선으로 개발한다.

AI는 Scheduler를 대체하지 않고 Scheduler가 더 좋은 결정을 할 수 있도록 정보를 제공한다.

---

이제 위 원칙을 기준으로 **Phase 0 Foundation만 구현하라.**

전체 프로젝트를 한 번에 구현하려 하지 말고, 먼저 repository와 개발환경을 안정적으로 구축한 뒤 결과를 검증하라.
