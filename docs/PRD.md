# PaceOn
## Product Requirements Document

**Your learning, at your pace.**  
**내 속도에 맞춰 계속 다시 짜주는 학습 계획**

PaceOn은 Pace + On의 결합으로, 사용자의 학습 페이스를 계속 켜두고 조정하는 개인 학습 운영체계를 뜻한다.

Version: 0.1  
Status: MVP  
Platform: Web / PWA  
Development: Local-first / Docker  
Language: Korean-first

---

# 1. Product Overview

## 1.1 제품 개요

PaceOn은 사용자가 학습하고자 하는 **책, 교재, PDF, 강의 등의 실제 학습자료를 기준으로 학습량을 분석하고 일정을 자동 생성하며, 실제 학습 결과에 따라 이후 일정을 지속적으로 재조정하는 웹 기반 학습·습관 관리 서비스​**다.

기존 Todo/Habit 앱처럼 단순히 일정 완료 여부를 기록하는 것이 아니라 다음 흐름을 핵심으로 한다.

```text
학습자료 등록
→ 학습단위 분석
→ 목표/가용시간 설정
→ 자동 일정 생성
→ 실제 학습
→ 진도 기록
→ AI 학습상태 평가
→ 일정 자동 재조정
```

핵심 질문은 다음과 같다.

> "내가 무엇을 공부할지 알려주면, 언제 무엇을 얼마나 공부해야 하는지 계획해주고 실제 생활에 맞게 계속 계획을 수정해 줄 수 있는가?"

---

# 2. Product Vision

단순한 Scheduler가 아니라 사용자의 실제 학습속도와 난이도를 학습하는

**Personal Adaptive Learning Planner**

를 목표로 한다.

장기적으로 시스템은 다음을 이해해야 한다.

- 사용자가 무엇을 공부하는가
- 전체 학습량이 얼마인가
- 각 학습단위의 난이도가 어떤가
- 사용자가 실제로 얼마나 빠르게 학습하는가
- 어떤 영역을 어려워하는가
- 현재 계획이 현실적인가
- 목표일을 지킬 수 있는가
- 언제 복습이 필요한가

---

# 3. Product Principles

## 3.1 Resource First

학습계획의 출발점은 Task가 아니라 **Resource**다.

Resource 예:

- Book
- Textbook
- PDF
- Online Course
- Video Course
- Certification Material
- Custom Material

---

## 3.2 Progress ≠ Mastery

진행률과 이해도를 분리한다.

### Content Progress

얼마나 진행했는가.

예:

```text
전체 300페이지
현재 150페이지

Progress = 50%
```

시스템 계산.

### Schedule Progress

계획 대비 수행률.

예:

```text
이번 주 계획 100p
실제 82p

Schedule Progress = 82%
```

시스템 계산.

### Mastery Progress

실제로 얼마나 이해했는가.

AI + 학습 데이터로 추정한다.

---

# 4. Target Users

초기 대상:

- 자기계발을 꾸준히 하고 싶은 사용자
- 책을 계획적으로 읽고 싶은 사용자
- 영어교재를 일정에 따라 공부하는 사용자
- 자격증을 준비하는 사용자
- 온라인 강의를 완강하고 싶은 사용자
- 학습 계획을 세우지만 자주 밀리는 사용자

---

# 5. Core Use Cases

## UC-01 책 완독 계획

사용자가 책을 검색한다.

```text
책: Atomic Habits
전체: 320p
현재: 80p
하루 목표: 20p
가능요일: 월~금
```

시스템:

```text
남은 분량: 240p
필요 학습일: 12일

예상 완료일:
2026-10-01
```

일별 일정을 자동 생성한다.

---

## UC-02 목표일 기준 계획

사용자:

```text
책: English Grammar in Use
Unit: 1~145
목표일: 2026-12-31
가능요일: 월~금
```

시스템이 남은 학습일을 계산하여 Unit을 배분한다.

---

## UC-03 실제 진도 초과

오늘 계획:

```text
20페이지
```

실제:

```text
35페이지
```

결과:

```text
+15p Ahead
```

시스템은 미래 일정을 재계산하고 완료 예상일을 앞당긴다.

---

## UC-04 실제 진도 부족

오늘 계획:

```text
20p
```

실제:

```text
8p
```

부족:

```text
12p
```

재계획 정책에 따라 처리한다.

### Deadline Mode

목표일 유지  
→ 이후 일정의 일일 학습량 증가

### Pace Mode

하루 목표 유지  
→ 목표 완료일 변경

### Balanced Mode

일부 학습량 증가 + 일부 목표일 조정

---

# 6. Core Domain Model

핵심 데이터 흐름:

```text
Goal
  ↓
Resource
  ↓
Resource Unit
  ↓
Plan
  ↓
Schedule Session
  ↓
Progress Event
  ↓
Learning Evaluation
  ↓
Learner Profile
  ↓
Replanner
```

---

# 7. Resource Model

Resource는 학습자료의 최상위 객체다.

```text
Resource

type:
BOOK
PDF
COURSE
VIDEO
CUSTOM
```

주요 속성:

```text
id
user_id

title
type

author
publisher
isbn

total_pages
total_units

source
source_id

cover_url

status

created_at
updated_at
```

---

# 8. Resource Unit

Resource 하위의 실제 학습단위.

예:

책:

```text
Chapter 1
1~25p
```

영어교재:

```text
Unit 1
```

강의:

```text
Lecture 1
43min
```

Schema:

```text
resource_units

id
resource_id

parent_unit_id

title
sequence

unit_type

start_page
end_page

workload
estimated_minutes

difficulty
importance

ai_confidence
```

unit_type:

```text
CHAPTER
SECTION
UNIT
PAGE_RANGE
LECTURE
VIDEO
CUSTOM
```

---

# 9. Book Metadata

도서정보 Provider를 Adapter 구조로 설계한다.

```text
BookProvider

├─ YES24Provider
├─ GoogleBooksProvider
└─ ManualProvider
```

통합 인터페이스:

```text
BookMetadata

isbn
title
authors
publisher
published_date

page_count

table_of_contents

thumbnail
description
```

우선순위:

### 국내서

```text
YES24
→ Google Books
→ Manual
```

### 해외서

```text
Google Books
→ YES24
→ Manual
```

---

# 10. PDF / Learning Material Analysis

PDF 업로드 기능을 제공한다.

Flow:

```text
PDF Upload
→ Supabase Storage
→ Analysis Job
→ PDF Parser
→ AI Resource Analyzer
→ Structured Resource Units
```

AI가 판단하는 내용:

- 문서 제목
- 목차
- Chapter
- Section
- 페이지 범위
- 학습단위
- 기본 난이도
- 중요도
- 예상 학습시간

결과는 반드시 구조화된 JSON으로 저장한다.

---

# 11. AI Architecture

AI는 단순 챗봇 용도가 아니다.

4개 기능 영역으로 분리한다.

## 11.1 Resource Intelligence

학습자료 이해.

```text
Chapter 분석
Section 분석
난이도
중요도
개념 밀도
예상 학습시간
```

---

## 11.2 Learner Intelligence

사용자 학습 특성 파악.

```text
평균 학습속도
평균 세션시간
요일별 수행률
난이도별 실제 소요시간
선호 학습시간
```

---

## 11.3 Learning Evaluation

학습 결과 평가.

향후 데이터:

- 실제 학습시간
- 학습량
- 퀴즈 정답률
- 사용자 난이도 평가
- 복습 결과
- 사용자 질문
- 재학습 횟수

출력:

```text
mastery_score
difficulty_score
review_priority
confidence
```

---

## 11.4 AI Coach

학습상태를 사용자에게 설명한다.

예:

```text
이번 주 영어 학습량은 계획보다 14% 부족합니다.

하지만 최근 Unit당 학습속도가 약 11% 향상되어
목표일을 변경할 필요는 없습니다.

화요일과 목요일에 각각 15분씩 추가하는 것을 추천합니다.
```

---

# 12. AI Decision Boundary

AI가 계산하지 않는 것:

```text
날짜 계산
요일 계산
남은 페이지
페이지 진행률
남은 학습일
Deadline
Schedule 충돌
완료 Session
고정된 Session
```

이는 deterministic logic으로 처리한다.

AI가 판단하는 것:

```text
학습 난이도
개념 밀도
학습 중요도
사용자 체감 난이도
Mastery
복습 우선순위
예상 학습시간
```

---

# 13. Scheduler Engine

Scheduler는 AI와 독립된 순수 TypeScript 모듈로 구현한다.

위치:

```text
packages/scheduler
```

입력:

```text
resource units
current progress
start date
target date

available days
available minutes

preferred workload

difficulty
estimated duration

schedule mode
```

출력:

```text
schedule sessions
daily workload
estimated completion date
```

---

# 14. Scheduler Modes

## Deadline

목표일 고정.

학습량을 조정한다.

---

## Pace

일일 학습량 고정.

완료일을 조정한다.

---

## Balanced

목표일과 일일 학습량을 함께 조정한다.

MVP 기본값.

### Phase 2 정책 v1

- Book은 연속 완료 페이지 이후의 정수 페이지를 배분한다. 강의·Unit 분할은 후속 범위다.
- Balanced는 선호 분량 대비 기본 20% 증가 상한(정수 내림)을 적용하고, 가용시간 상한 안에서 목표일 충족을 시도한다. 부족한 분량은 이후 학습일로 확장한다. 상한 비율은 명시적 입력으로 조정할 수 있다.
- 가용시간은 사용자 전체의 일일 강제 제약이다. 여러 자료는 동일 예산을 공유하며, 외부 예약과 고정 세션의 시간을 중복 소비하지 않는다.
- Deadline은 목표일 내 수용량이 부족하면 계획 불가를 반환한다. Pace는 선호 분량이 해당 학습일의 가용시간에 맞지 않으면 충돌을 반환한다.
- 기본 속도는 최근 30일의 유효 신규 페이지 학습 표본 3개 이상에서 총 소요 분 / 총 페이지로 계산한다. 표본이 부족하면 호출자가 제공한 초기 예상 시간을 사용한다. 복습·무효화·중복 기록을 신규 속도 표본과 섞지 않는다.
- 재계획은 기준 학습일 다음 날부터만 변경한다. 과거·오늘·완료·고정·진행 중 세션은 보존하며, 충돌 시 일부 일정만 적용하지 않는다.

세부 입력·충돌 코드·탐색 상한과 동일 날짜의 페이지 순서 계약은 `docs/SCHEDULER.md`를 따른다.

---

# 15. Replanner

Progress Event 발생 시 Replanner 실행 여부를 판단한다.

```text
Progress Event
      ↓
계획과 실제 비교
      ↓
replan needed?
      ↓
Scheduler
```

변경 금지:

```text
과거 Session
완료 Session
사용자 고정 Session
```

변경 가능:

```text
미래 Session
미완료 Session
```

---

# 16. Progress Event

현재 상태만 저장하지 않고 Event를 기록한다.

```text
progress_events

id
user_id
resource_id
unit_id
session_id

started_at
completed_at

start_page
end_page

completed_workload

duration_minutes

difficulty_feedback
memo

created_at
```

이를 이용해:

- 독서속도
- 학습속도
- 계획 대비 실적
- 예상 완료일
- Personal Workload

등을 계산한다.

---

# 17. Learner Profile

사용자의 실제 학습패턴을 저장한다.

```text
learner_profiles

user_id

average_session_minutes

page_per_minute

unit_per_hour

completion_rate

preferred_days
preferred_time

workload_multiplier

updated_at
```

향후 영역별 profile 지원.

```text
READING
ENGLISH
CODING
CERTIFICATE
```

---

# 18. Personal Workload

장기 핵심 기능.

같은 20페이지라도 사용자에게 느껴지는 부담은 다르다.

초기 개념:

```text
Personal Workload

base workload
× resource difficulty
× content density
× learner multiplier
```

실제 기록을 통해 learner multiplier를 지속 보정한다.

---

# 19. Habit System

학습 Resource와 Habit은 내부적으로 분리한다.

Habit 예:

```text
영어단어 30개
30분 걷기
명상 10분
```

하지만 Calendar에서는 통합 표시한다.

Session source_type:

```text
RESOURCE
HABIT
REVIEW
MANUAL
```

---

# 20. Main Screens

## Today

오늘 해야 할 항목.

```text
오늘의 학습

Grammar in Use
Unit 13~14
40분

Atomic Habits
120~140p
20페이지

영어단어
30개
```

---

## Calendar

일/주/월 일정.

지원:

- Session 이동
- Session 고정
- 완료
- 미완료
- 재계획

---

## Resource

등록된 학습자료.

표시:

```text
Cover
Title
Progress

계획 진행률
실제 진행률
Mastery

예상 완료일
```

---

## Resource Detail

```text
Atomic Habits

진도
54%

142 / 320p

예상 완료
10월 18일

원래 목표
10월 24일

6일 Ahead
```

하단:

- Chapter
- Sessions
- Progress History
- AI Analysis

---

## Add Resource

방법:

```text
도서 검색
ISBN
PDF
직접 입력
```

---

## Analytics

MVP:

- 이번 주 학습시간
- 계획 대비 수행률
- Resource별 진행률
- 예상 완료일
- Streak

---

# 21. Frontend Architecture

Technology:

```text
Next.js
TypeScript
App Router

Tailwind CSS
shadcn/ui
```

초기 Web/PWA.

Deployment:

```text
Vercel
```

---

# 22. Backend Architecture

## Supabase

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

---

## Heavy Worker

Python + FastAPI.

운영:

```text
Hostinger VPS
```

개발:

```text
Docker
```

담당:

```text
PDF parsing
AI Resource Analysis
AI Evaluation
Embedding
OCR
Background Jobs
```

---

# 23. Development Architecture

로컬 개발:

```text
Developer PC

Next.js
pnpm dev

      │

Docker

├─ Supabase Local
└─ FastAPI AI Worker
```

Next.js는 Docker 외부에서 직접 실행한다.

이유:

- 빠른 HMR
- Windows/WSL volume 문제 감소
- 디버깅 편의

---

# 24. Repository Structure

Monorepo.

```text
paceon/

apps/

  web/
    Next.js

services/

  ai-worker/
    FastAPI
    Python

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

.env.example
README.md
```

Package Manager:

```text
pnpm
```

---

# 25. Infrastructure

## Development

```text
Web
localhost:3000

AI Worker
localhost:8000

Supabase
Supabase Local
```

---

## Production

```text
Next.js
→ Vercel

PostgreSQL/Auth/Storage
→ Supabase Cloud

AI Worker
→ Hostinger VPS

Optional Worker
→ Local Mini PC
```

Mini PC는 production critical dependency로 사용하지 않는다.

---

# 26. Queue Architecture

PDF 분석과 AI 작업은 asynchronous job으로 처리한다.

```text
Upload
↓
Supabase Storage
↓
Job
↓
Queue
↓
AI Worker
↓
AI / Parser
↓
DB
↓
Realtime
↓
UI
```

Job status:

```text
PENDING
PROCESSING
COMPLETED
FAILED
```

---

# 27. MVP Scope

## P0 — 반드시 구현

### Auth

- Email login
- User profile

### Resource

- Book 직접 입력
- Google Books 검색
- YES24 Adapter 구조
- ISBN
- page count
- current page

### Planning

- target date mode
- daily workload mode
- available weekdays
- schedule generation

### Progress

- 오늘 학습량 입력
- page progress
- session complete

### Replanning

- Deadline
- Pace
- Balanced

### UI

- Today
- Calendar
- Resources
- Resource Detail

---

# 28. MVP AI Scope

MVP에서도 AI를 사용한다.

### AI Resource Analysis

PDF / 목차 분석.

### Difficulty Estimation

학습단위별:

```text
difficulty
estimated_minutes
importance
confidence
```

### Basic AI Coach

현재 학습상황 설명.

---

AI Mastery Evaluation은 데이터가 충분하지 않은 초기에는 제한적으로 사용한다.

---

# 29. P1

- PDF Upload
- AI Chapter Analysis
- Supabase Queue
- VPS Worker
- Habit Tracker
- AI Difficulty personalization
- Reading speed learning
- Statistics
- Push notifications
- PWA

---

# 30. P2

- Quiz generation
- Mastery Evaluation
- Spaced Repetition
- AI adaptive review
- YouTube / Course integration
- Google Calendar integration
- Mobile app
- Local AI Worker
- Knowledge Graph

---

# 31. Non Goals — MVP

초기 버전에서는 다음을 구현하지 않는다.

- Social 기능
- 친구 기능
- Leaderboard
- Marketplace
- Chat 커뮤니티
- 자체 LLM
- 복잡한 Recommendation Engine
- Native mobile app

---

# 32. UX Principles

### 입력을 최소화한다.

책 검색 후 가능한 정보를 자동 입력한다.

### 사용자가 AI를 관리해야 하지 않는다.

AI는 백그라운드에서 동작한다.

### 일정 재조정은 이유를 설명한다.

예:

```text
이번 주 계획보다 32페이지 부족하여
남은 12개 학습일에 하루 평균 3페이지를 추가했습니다.
```

### AI 판단에는 confidence를 사용한다.

```text
Difficulty
4.2 / 5

Confidence
72%
```

---

# 33. Security

- Supabase RLS 필수
- Service Role Key 브라우저 노출 금지
- External API Key Server Side Only
- OpenAI Key Server Side Only
- User files private bucket
- Signed URL 사용
- AI Worker 인증 필수
- 사용자별 데이터 완전 분리

---

# 34. Coding Principles

1. TypeScript strict mode
2. Business Logic을 React Component에 작성하지 않는다.
3. Scheduler는 UI와 완전 독립.
4. External API는 Adapter Pattern 사용.
5. AI Response는 반드시 JSON Schema / Zod validation.
6. DB Schema 변경은 Migration 사용.
7. 발생 시각(created_at, started_at, completed_at 등)은 timestamptz로 저장하고 UTC로 교환한다. 학습일·시작일·목표일·예상 완료일은 사용자 시간대의 달력 날짜(date)로 분리한다.
8. UI 시각 표시에서 사용자 Timezone을 적용한다. 계획과 학습 기록은 당시 timezone을 보존하여 설정 변경으로 과거 학습일이 달라지지 않게 한다.
9. AI 장애 시 기본 Scheduler는 정상 동작해야 한다.
10. 개발 중이라도 production-quality 구조를 유지한다.

---

# 35. Definition of Done — MVP

사용자가 다음 과정을 완료할 수 있어야 한다.

```text
회원가입

→ 책 검색 또는 직접 등록

→ 현재 페이지 입력

→ 목표일 또는 하루 학습량 설정

→ 가능한 학습요일 설정

→ 자동 학습계획 생성

→ Today에서 오늘 할 분량 확인

→ 실제 읽은 페이지 기록

→ 계획 대비 결과 계산

→ 미래 일정 자동 재조정

→ 완료 예상일 변경 확인
```

그리고 시스템은 다음 정보를 보여줘야 한다.

```text
현재 진행률

계획 진행률

오늘 목표

실제 수행량

Ahead / Behind

예상 완료일

목표 완료일
```

---

# 36. Product North Star

이 제품의 핵심은 캘린더가 아니다.

핵심 질문은 이것이다.

> "현재 나의 실제 학습속도로 이 목표를 언제 달성할 수 있는가?"

그리고 그 답을 매일 다시 계산한다.

최종적으로 사용자가 느껴야 할 경험은 다음과 같다.

> 내가 계획을 관리하는 것이 아니라  
> 시스템이 내 학습을 보면서 계획을 계속 관리해준다.
