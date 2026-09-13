# PaceOn 구현 준비

작성일: 2026-09-12  
상태: Phase 1 Core Domain 구현 및 검증 완료 (최신 기록은 §13)  
요구사항 기준: [PRD.md](PRD.md)  
개발 순서 기준: [prompt.md](prompt.md)  
화면·디자인 기준: [DESIGN.md](DESIGN.md)

이 문서는 기존 요구사항을 정리하고, 미정인 정책의 권장안을 구분한다. PRD를 대체하거나 미정 정책을 확정하지 않는다. 이번 작업은 문서 검토와 구현 준비이며, 개발 프롬프트에 포함된 Phase 0 실행은 후속 구현 작업의 범위다.

## 1. 제품 정의

**PaceOn — Your learning, at your pace.**  
**내 속도에 맞춰 계속 다시 짜주는 학습 계획**

Pace + On: 사용자의 학습 페이스를 계속 켜두고 조정하는 개인 학습 운영체계.

핵심 경험은 다음과 같다.

1. 실제 학습자료와 현재 진도를 등록한다.
2. 목표일 또는 하루 학습량, 학습 가능한 요일과 시간을 설정한다.
3. 오늘 할 구체적인 분량을 받는다.
4. 실제 학습량과 소요시간을 기록한다.
5. 시스템이 실제 속도와 남은 분량을 반영해 미래 계획을 다시 계산한다.
6. 무엇이 왜 바뀌었는지, 현재 속도로 언제 끝나는지 확인한다.

진행률, 계획 대비 수행률, 이해도는 별도 지표다. DESIGN §24에 따라 이해도 데이터가 없으면 해당 영역을 숨기고, 읽은 분량을 이해도로 대체하지 않는다. 제품 표기는 `PaceOn`, 향후 디렉터리와 패키지 식별자는 `paceon` / `@paceon/*`을 권장한다.

## 2. 현재 프로젝트와 개발 환경

검토 시작 시 프로젝트에는 `docs/PRD.md`, `docs/prompt.md`만 있었다. 앱 코드, 패키지 설정, DB migration, Git 저장소와 별도 AGENTS.md는 확인되지 않았다.

로컬 명령으로 확인한 상태:

| 항목 | 관찰 결과 | 구현 착수 시 할 일 |
| --- | --- | --- |
| Node.js | v24.14.0 | 선택한 의존성과의 호환성을 확인하고 버전 고정 |
| pnpm | 9.15.0 | workspace 및 packageManager에 사용할 버전 고정 |
| Python | 3.14.3 | Worker 컨테이너 런타임과 의존성 호환성 별도 확인 |
| Docker | CLI 29.7.2, Linux 엔진 연결 실패 | Docker Desktop의 Linux 엔진 기동 확인 |
| Supabase CLI | 실행 파일 발견 | 버전 및 Local 시작 가능 여부 확인 |
| Git | 실행 파일 발견, 현재 폴더는 저장소 아님 | 구현 시작 시 저장소 초기화 |

의존성을 설치하거나 서비스를 실행하지 않았다. 위 버전은 관찰값이며 기술 버전 선정 결과가 아니다. Docker 엔진 연결 실패 때문에 Supabase와 Worker의 실행 검증은 아직 할 수 없다.

## 3. 문서에서 확정된 구조

| 경계 | 책임 | 의존성 원칙 |
| --- | --- | --- |
| `apps/web` | 한국어 중심 반응형 UI, 인증, 서버 요청 처리 | 컴포넌트 밖에 업무 로직 배치 |
| `packages/scheduler` | 학습일 계산, 분량 배분, 완료일 예측, 재계획 | React·Next.js·Supabase·AI 호출에 의존하지 않는 TypeScript |
| `packages/shared` | 공통 도메인 타입과 검증 계약 | 웹 프레임워크에 의존하지 않음 |
| `packages/ai-schema` | AI 구조화 결과 계약 | JSON Schema/Zod와 Python 검증 계약의 일치 필요 |
| `supabase` | Auth, PostgreSQL, RLS, Storage 및 후속 비동기 작업 | 스키마 변경은 migration으로 재현 |
| `services/ai-worker` | PDF·분석·평가 작업 | 초기에는 FastAPI health skeleton, 핵심 일정 계산과 분리 |
| `docker` | 로컬 Worker 실행 구성 | Next.js는 호스트에서 실행 |

핵심 데이터 흐름:

```text
Resource / ResourceUnit + Goal / AvailabilityRule
  → Plan → ScheduleSession
  → ProgressEvent → 진도·속도 집계
  → ReplanRun → 변경 가능한 미래 ScheduleSession
                 → 변경 이유·완료 예상일
```

날짜, 남은 분량, 충돌, 실제 기록 보존은 결정론적 로직이 담당한다. AI는 난이도·예상 시간·이해도 등의 보조 입력과 설명을 제공한다. AI나 도서 검색이 실패해도 직접 등록과 기본 계획·재계획은 동작해야 한다.

## 4. 구현 접근 비교

| 접근 | 장점 | 한계 |
| --- | --- | --- |
| 기반 → 도메인 → 스케줄러 → 화면 → 실제 기록 연결 | 기존 개발 순서와 일치하고 핵심 계산을 독립 검증 가능 | 첫 사용자 흐름 완성까지 단계가 필요 |
| 화면과 모의 데이터부터 구현 | 사용 경험을 빨리 볼 수 있음 | 재계획 계약이 늦게 정해져 화면·데이터 재작업 가능 |
| PDF·AI 분석부터 구현 | 자료 분석 경험을 먼저 확인 | 외부 의존성이 많고 실제 페이스 조정 검증이 늦어짐 |

첫 번째 접근을 권장한다. Phase 0에서는 기반을 검증하고, 이후 각 단계를 작은 단위로 이어서 최초의 등록 → 계획 → 기록 → 재계획 흐름을 완성한다.

## 5. 구현 전 해소할 명세 차이

| 항목 | 문서의 현재 상태 | 권장 정리 및 결정 시점 |
| --- | --- | --- |
| MVP AI 범위 | PRD §28은 MVP AI 분석을 포함하나 §29는 PDF·분석을 P1로 분류 | Phase 0~5 핵심 루프, Phase 6 기본 AI, PDF/Queue는 후속으로 구분. AI 포함 출시 범위는 Phase 6 전 확정 |
| 실제 학습속도 반영 | 제품의 핵심이나 Reading speed learning은 P1 | 분량 기반 재계획은 P0, 소요시간 기록 기반 기본 속도 보정도 핵심 루프에 포함하는 안을 검토. 영역별·난이도별 개인화는 P1 |
| Balanced | 기본 모드라는 선언만 있고 알고리즘이 없음 | 증가 상한과 완료일 조정 순서를 Phase 2 전에 확정 |
| 가용시간 | Scheduler 입력에는 존재하나 P0 계획 항목은 요일 중심 | 일일 총시간을 제약으로 적용할지 Phase 2 전에 확정 |
| 로컬 Supabase | Supabase Local과 Docker Compose가 함께 기술됨 | Supabase CLI가 Local을 관리하고 Compose는 Worker를 관리하는 구성 권장. 두 명령의 책임을 README에 명시 |
| 날짜 저장 | 모든 날짜를 UTC 저장하라는 규칙 | 발생 시각은 UTC, 학습일은 사용자 timezone에 속한 달력 날짜로 별도 모델링하는 예외를 Phase 1 전에 PRD에 명시 |
| 최초 진도 | 등록 시 current page와 이벤트 기반 진도가 함께 있음 | 최초 진도를 기준값으로 보존하고 이후 신규 학습 이벤트를 합산 |
| 예시 수치 | PRD §20은 142/320p를 54%로 표시 | 실제 계산은 44.375%. UI 예시는 정정하고 수치를 직접 계산 |
| 예시 완료일 | PRD §5.1은 시작일 없이 완료일 지정 | 테스트에는 명시적 시작일과 시간대를 사용 |

이 표의 권장안은 기존 요구사항을 임의 변경한 것이 아니다. 해당 Phase 착수 전에 PRD와 구현 계약에 반영해야 할 검토 대상이다.

## 6. Scheduler와 Replanner 설계 제안

### 입력과 출력

입력은 학습단위와 정렬 순서, 진도 기준값 및 실제 기록, 기준 학습일, 사용자 시간대, 목표일, 가능 요일·시간, 일일 선호 분량, 모드, 기존 세션이다. 현재 시각을 모듈 내부에서 읽지 않고 기준값으로 주입하여 같은 입력에 같은 결과가 나오게 한다.

출력은 세션별 날짜·분량·예상 시간, 완료 예상일, 제약 충돌, 변경 전후 차이와 구조화된 변경 이유다. 실행 불가능한 경우 결과를 성공 일정처럼 표시하지 않는다.

### 모드별 정책 제안

- **Deadline:** 목표일까지 남은 가능일에 남은 분량을 배분한다. 가용시간이 부족하면 목표일 유지 불가능 상태와 필요한 추가량을 반환한다.
- **Pace:** 선호 일일 분량을 유지하고 가능한 날짜에 배치한다. 마지막 세션은 잔여량만 배치한다. 하루 수용량보다 선호 분량이 크면 충돌로 알린다.
- **Balanced:** 기본 선호 분량 대비 증가 상한을 정책값으로 둔다. 상한 안에서 목표일 충족을 시도하고, 부족한 분량은 이후 가능일로 확장한다. 예를 들어 상한이 20%라면 20p/day에서 최대 24p/day이며, 이 수치는 검토용 예시로 기본값 확정이 필요하다.

단위별 분할 가능 여부를 구분한다. 페이지는 정수 분할할 수 있지만, 강의·Unit은 별도 분할 정책 없이 쪼개지 않는다. P0에서는 연속 페이지 기반 Book 흐름을 먼저 완성한다.

### 반드시 유지할 조건

- 신규 배정 분량은 남은 분량과 같고 페이지 누락·중복이 없어야 한다.
- `current_page = 80`은 80페이지까지 완료했음을 의미하며 다음 시작은 81페이지다.
- 과거, 완료, 고정 세션은 보존한다. 자동 수정 대상은 이 조건에 해당하지 않는 미래 미완료 세션이다.
- 고정 세션이 이미 읽은 범위와 겹치면 이를 보존한 채 충돌을 반환한다. 몰래 수정하거나 같은 범위를 새 세션에 중복 배정하지 않는다.
- 학습 가능일 0개, 지난 목표일, 잔여량 0, 시간 부족을 각각 명시적인 결과로 처리한다.
- 여러 자료의 시간 예산은 사용자 기준으로 합산한다. 자료마다 하루 전체 가용시간을 중복 소비하면 안 된다.
- 계획 수행률은 당시 계획의 기준 분량으로 계산한다. 재계획 후 새 분모를 써서 지난 미달을 지우지 않는다.

### 재계획 발생과 동시성

진도 저장, 계획 설정 변경, 미수행 학습일 마감 시 재계획 필요성을 판단한다. 기록이 없는 날에도 다음 접속 또는 일마감 작업을 통해 밀린 분량을 반영해야 한다. 초기에는 다음 접속 시 누락 학습일을 확인하는 방식을 검토하고, 상시 자동 마감은 후속 작업으로 분리한다.

권장 저장 경계는 ProgressEvent 중복 방지 키, Plan 버전 확인, 진도 projection 갱신, ReplanRun 및 미래 세션 갱신을 하나의 원자적 작업으로 처리하는 것이다. 실패 시 일부 일정만 바뀌지 않도록 전체를 되돌리고 재시도 가능하게 한다. 실제 DB 구현 방식은 Phase 1에서 정한다.

오늘의 부분 기록은 여러 번 입력할 수 있어야 한다. 오늘 세션의 계획 기준을 보존하고 누적 실적을 연결하며, 미래 배정만 다시 계산하는 정책을 권장한다. 수정 기록은 원기록을 추적할 수 있는 정정 이벤트로 처리하는 방안을 도메인 단계에서 정한다.

### 실제 속도 추정

유효한 신규 학습 기록의 총분량 / 총학습시간으로 기본 속도를 산출하는 안을 권장한다. 0분·누락 시간은 속도 표본에서 제외하되 진도에는 반영한다. 복습은 속도와 신규 진도에서 구분한다. 페이지와 강의 Unit의 속도를 섞지 않는다.

표본이 부족하면 초기 예상 시간을 사용하고 추정 상태를 표시한다. 최소 표본 수·관측 구간·이상치 처리 기준은 Phase 2 전에 정한다. 사용자가 설정한 목표일과 현재 속도 기반 완료 예상일은 별도로 보존한다.

## 7. 도메인과 화면 준비

Phase 1에서 정의할 주요 엔티티는 User, Goal, Resource, ResourceUnit, Plan, AvailabilityRule, ScheduleSession, ProgressEvent, ReplanRun, LearnerProfile이다. 아래 항목을 DB 설계 문서에 구체화한다.

- 사용자 소유권과 RLS, 사용자 간 참조를 차단하는 관계 제약.
- 페이지 범위·양수 분량·시간·순서 등 입력 제약.
- 최초 진도와 이후 기록의 관계, 계획 버전, 멱등성 키.
- 시간대와 학습일, 발생 시각, 완료/고정 상태.
- 재계획 전후 결과, 원인, 정책 버전, 적용 성공 여부.
- 학습 속도의 산출 근거와 이해도 평가의 confidence.

| 화면 | 핵심 역할 | 검증할 사용자 경험 |
| --- | --- | --- |
| `/login` | 이메일 인증 | 로그인 후 본인 자료에만 접근 |
| `/today` | 오늘 분량과 실제 기록 | 미달·초과 기록 후 변경 이유 확인 |
| `/calendar` | 일정과 고정 여부 | 이동·고정 시 제약 검증, 재계획 시 고정 보존 |
| `/resources` | 자료별 진행상태 | 실제 진도·계획 대비 수행률·예상 완료일 구분 |
| `/resources/new` | 직접 입력·도서 검색 | 검색 실패 시 직접 등록 계속 가능 |
| `/resources/[id]` | 자료 상세와 이력 | 목표일·예상일·학습 기록·재계획 이력 확인 |

한국어 우선, 차분하고 간결한 반응형 UI를 따른다. 자동 재조정 설명은 실제 계산 결과에서 생성하며 AI 설명이 수치와 날짜를 바꾸지 않도록 한다.

## 8. 단계별 착수 및 완료 기준

아래는 단계별 준비 체크리스트다. 코드와 명령을 포함하는 상세 실행 계획은 각 단계의 정책 및 의존성 버전을 정한 뒤 별도로 작성한다.

### Phase 0 — Foundation: 첫 구현 범위

예정 파일과 책임:

| 파일/경로 | 책임 |
| --- | --- |
| `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | workspace, 실행 스크립트, 버전 고정 |
| `tsconfig.base.json`, `.gitignore`, `.env.example` | strict 공통 설정, 산출물·비밀 제외, 환경변수 안내 |
| `apps/web/package.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx` | Next.js 기반 및 PaceOn 시작 화면 |
| `apps/web/src/app/api/health/route.ts` | 웹 프로세스 health |
| `packages/scheduler/package.json`, `packages/scheduler/src/index.ts` | 독립 패키지 및 export 확인 |
| `packages/shared/package.json`, `packages/shared/src/index.ts` | 공통 타입 패키지 경계 |
| `services/ai-worker/pyproject.toml`, `services/ai-worker/app/main.py`, `services/ai-worker/Dockerfile` | FastAPI 프로세스와 `/health` |
| `supabase/config.toml` | Supabase Local 설정 |
| `docker/docker-compose.yml` | Worker 서비스와 healthcheck |
| `README.md`, `docs/ARCHITECTURE.md` | 설치·실행·검증 절차 및 책임 경계 |

- [ ] Docker Linux 엔진 및 Supabase CLI 상태를 확인한다.
- [ ] 의존성 공식 문서에서 런타임 호환성을 확인하고 버전을 고정한다.
- [ ] Git, pnpm workspace, Next.js, shared, scheduler 기반을 구성한다.
- [ ] Supabase Local과 FastAPI skeleton을 구성한다.
- [ ] Supabase CLI와 Worker Compose를 실행하는 정확한 순서를 README에 적는다. Compose 파일을 하위 폴더에 둘 경우 `docker compose -f docker/docker-compose.yml up -d`처럼 경로를 명시한다.
- [ ] 비밀값 없는 `.env.example`과 서버 전용 키 경계를 작성한다.
- [ ] `pnpm install`, 타입 검사, 웹 build, 패키지 import를 확인한다.
- [ ] `pnpm dev` 후 `http://localhost:3000` 페이지와 웹 health, `http://localhost:8000/health`, Supabase Local 상태를 실제 확인한다.
- [ ] 웹·Worker 자체 health와 DB/외부 서비스 준비 상태를 구분하여 결과를 기록한다.

Phase 0에는 전체 업무 기능이나 실제 AI 분석을 포함하지 않는다. 아직 명령·스크립트는 생성 전이므로 위 항목은 실행 성공을 뜻하지 않는다.

### Phase 1 — Core Domain

- [ ] `docs/DATABASE.md`에 엔티티·관계·제약·RLS·계획 버전 계약을 작성한다.
- [ ] migration 및 개발 seed를 작성하고 빈 DB에서 재현한다.
- [ ] 두 사용자의 읽기·쓰기·관계 참조가 분리되는지 검증한다.

### Phase 2 — Scheduler Engine

- [ ] Balanced, 가용시간, 날짜, 속도 추정 정책을 확정하고 `docs/SCHEDULER.md`에 기록한다.
- [ ] Deadline/Pace/Balanced 및 보존 조건을 순수 TypeScript와 Vitest로 검증한다.
- [ ] 아래 수용 시나리오와 불가능한 계획의 반환 계약을 검증한다.

### Phase 3 — Book Resource

- [ ] 직접 등록, Google Books 검색, ISBN·페이지 수 보정을 구현한다.
- [ ] YES24는 Provider 인터페이스와 미지원 상태를 준비한다. 실제 연동이 된 것처럼 표시하지 않는다.
- [ ] 외부 검색 실패 시 수동 등록과 계획 생성이 가능한지 확인한다.

### Phase 4 — Basic UI

- [ ] 인증과 여섯 경로를 연결하고 모바일·데스크톱에서 확인한다.
- [ ] 자료와 계획을 저장하고 새로고침 후 복원한다.
- [ ] 빈 상태·오류 상태·목표일과 예상일을 구분하고, 이해도 데이터가 없으면 해당 영역을 숨긴다.

### Phase 5 — Progress / Replanning

- [ ] 실제 기록 → 진도·속도 projection → 미래 재계획 → 이유 표시를 연결한다.
- [ ] 중복 제출, 동시 변경, 미기록일, 부분 기록, 초과 학습, 고정 충돌을 검증한다.
- [ ] PRD §35의 회원가입부터 변경 완료일 확인까지 전체 흐름을 검증한다.

### Phase 6 이후 — AI 및 확장

- [ ] AI 범위와 스키마를 확정하고 기본 난이도·예상 시간·Coach를 연결한다.
- [ ] AI 실패 상황에서도 핵심 흐름이 유지되는지 검증한다.
- [ ] PDF/Queue/Worker 본 기능, Habit, 통계, 알림, PWA는 PRD 우선순위에 따라 별도 계획으로 진행한다.
- [ ] Mastery·복습·강의 연동 등 P2는 충분한 데이터와 별도 요구사항을 갖춘 뒤 진행한다.

## 9. 핵심 수용 시나리오

모든 날짜 예시는 `Asia/Seoul`, 시작일 포함, 별도 공휴일 제외 없이 월~금 학습을 가정한다.

| 시나리오 | 입력/조건 | 기대 결과 |
| --- | --- | --- |
| 기본 Pace | 320p, 현재 80p, 20p/day, 2026-09-14 시작 | 남은 240p, 12회, 첫 81~100p, 마지막 301~320p, 완료 2026-09-29 |
| Deadline 균등 분배 | 동일 분량, 목표 2026-09-25, 시간 제약 없음 | 10학습일 × 24p, 합계 240p |
| Pace 미달 | 첫날 20p 계획에 실제 10p, 그날 추가 기록 없음 | 다음날 91p부터 230p 배분, 미래 12회, 완료 2026-09-30 |
| Pace 초과 | 첫날 20p 계획에 실제 40p | 다음날 121p부터 200p 배분, 미래 10회, 완료 2026-09-28 |
| Balanced 상한 예시 | 잔여 240p, 8학습일, 선호 20p, 상한 24p, 시간 제약 없음 | 목표일까지 192p, 이후 2학습일에 48p. 실제 기본 상한은 별도 확정 |
| 보존 | 과거·완료·고정 세션 존재 | 원본 보존, 충돌은 명시적 결과로 반환 |
| 중복 기록 | 동일 멱등성 키로 재전송 | 진도와 재계획이 한 번만 적용 |
| 가용일 없음 | 선택 요일 없음 | 무한 반복 없이 계획 불가 반환 |
| 완료 상태 | 현재 페이지 = 총페이지 | 신규 세션 0개, 완료 상태 |
| 속도 데이터 없음 | 학습시간 미입력 | 진도 반영, 속도 표본 제외, 기본 추정 유지 |
| 시간대 경계 | UTC 날짜와 사용자 날짜가 다른 기록 | 사용자 학습일에 실적 귀속 |
| AI 장애 | 분석 요청 실패 | 등록·진도 저장·기본 재계획 가능 |

위 수치는 준비 단계의 기대값이며 실제 Scheduler 테스트 실행 결과가 아니다.

## 10. 다음 착수 지점

첫 구현은 `prompt.md`의 Phase 0 Foundation이다. Docker 엔진 기동 확인, 버전 호환성 확인, 저장소와 workspace 구성이 첫 작업이다. Balanced 수식 등 Phase 2 정책은 기반 구성 이후 확정해도 되지만, DB 날짜 모델과 계획 버전 계약은 Phase 1 전에 정해야 한다.

이 문서를 통해 제품 방향, 기존 요구사항, 구현 순서, 환경 장애, 정책 결정 지점과 수용 기준을 확인할 수 있다. 상세 구현이나 동작 검증이 완료되었다는 의미는 아니다.

## 11. DESIGN.md 추가 검토

DESIGN v0.1의 54개 절을 검토했다. Today 중심의 행동, 실제/계획 진도 비교, 완료 예상일, 조용한 AI, 재조정 이유 설명은 PRD의 핵심 흐름과 일치한다. 아래 내용을 UI 구현 기준으로 반영한다.

- Light 기본, 따뜻한 배경 `#FAFAF8`, 주색 `#5965E8`, Pretendard, 최소한의 그림자와 장식.
- 데스크톱은 Sidebar/Main/Context Panel, 모바일은 하단 내비게이션·인라인 Insight·Day/Agenda 중심 Calendar.
- Library는 표지와 목록 조합, 계획 입력은 단계별 Wizard, 기본 진입 화면은 Today.
- ProgressComparison, CompletionForecast, ScheduleAdjustment는 계산된 데이터를 받는 도메인 컴포넌트로 분리.
- 이해도 데이터가 없으면 영역 숨김. 난이도는 기본적으로 쉬운 표현을 쓰고 상세에서 수치와 confidence 제공.
- 한국어 UI 문구, 색과 텍스트를 함께 사용하는 상태 표시, 키보드 탐색과 포커스 처리를 적용.

### 구현 전에 맞출 항목

| 항목 | 검토 결과와 처리 방향 |
| --- | --- |
| 브랜드 | DESIGN 제목은 아직 Adaptive Learning Scheduler다. 제품 표기는 사용자가 정한 PaceOn을 따른다. |
| 진도 예시 | DESIGN §18·19의 142/320p = 54%는 산술적으로 불일치한다. 실제 값은 44.375%이며 화면에서는 정한 반올림 정책을 사용한다. |
| MVP 화면 범위 | DESIGN §45는 `/insights`, `/settings`를 추가한다. 기존 prompt의 6개 화면보다 넓으므로 Phase 4 전 출시 범위를 정한다. Habit/PDF/Course/ISBN 스캔은 디자인에 있어도 자동으로 P0 기능이 되지 않는다. |
| 재조정 우선순위 | DESIGN §52의 Schedule Adjustment는 Priority 3이지만, 변경 이유 표시는 PRD의 필수 경험이다. 기본 변경 이유·결과는 Phase 5에 포함하고, 상세 비교 UI의 구현 순서는 별도로 조정한다. |
| Undo와 유지 | DESIGN §2.5·21은 되돌리기와 유지 제어를 추가한다. 실제 학습 기록은 보존하고 일정 변경만 복구하는 정책, 적용 전/후 상태, 이후 기록이 있는 경우의 충돌 처리를 Phase 5 전에 정의해야 한다. |
| 자동 적용과 제안 | DESIGN §49의 “내일 일정에 반영할까요?”는 승인 전 제안이며, §54는 자동 재계획이다. 자동 적용 후 설명인지 적용 전 확인인지 상태별 문구와 버튼 동작을 구분해야 한다. |
| 테마 토큰 | Dark 토큰은 Light보다 일부 항목이 빠져 있다. `text-primary`도 본문색과 브랜드 primary의 이름 충돌 여지가 있어 shadcn 의미 토큰과 명확히 매핑해야 한다. |
| 접근성과 반응형 | 작은 보조 텍스트·상태색의 실제 배경 대비를 검증해야 한다. 32px Small 버튼은 최소 40px hit area와 구분한다. 3열 최소 폭 합계는 1060px에 간격이 더해지므로 1024px 직후부터 3열을 강제하지 않는다. |
| 진도 차이 단위 | 실제 54%, 계획 51%의 차이는 3퍼센트포인트다. `+3%` 예시를 그대로 계산 계약으로 쓰지 말고 퍼센트포인트 또는 페이지 차이로 명시한다. |

DESIGN 원문은 이번 검토에서 수정하지 않았다. 이 절은 추가 문서의 반영 사항과 조율할 항목을 기록한 것으로, 미정 기능 범위를 확정하거나 화면 구현을 시작한 것이 아니다.

## 12. Phase 0 실행 기록 — 2026-09-12

위 §1~11은 구현 전 검토 기록이다. 아래는 계속 진행 지시에 따른 실제 구현 상태이며, 최신 실행 방법은 루트 README를 따른다.

- `feat/phase-0-foundation` 브랜치에 pnpm workspace, Next.js 시작 화면, shared/scheduler 독립 패키지, FastAPI Worker, Compose와 환경변수 예제를 구성했다.
- Next.js 16.3.5 / React 19.3.0 / TypeScript 5.9.3 / Tailwind 4.3.3을 고정했다. Python은 호스트 3.14 대신 Docker의 3.13으로 통일하고 해석된 의존성을 잠갔다.
- Docker Desktop Linux 엔진을 시작했다. 다른 프로젝트가 기본 Supabase 포트를 점유해 PaceOn만 553xx로 분리했다.
- Supabase의 선택적 analytics 로그 수집기는 Docker TCP 2375 연결 실패로 반복 종료되어 비활성화했다. DB/Auth/Storage/Realtime/Studio는 정상 실행한다.
- `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`(1개), `pnpm test:smoke`(2개)가 통과했다.
- Worker Docker build와 healthy 상태, `pip check`, Supabase start 종료 코드 0, PostgreSQL 연결 수락, Auth health와 Studio HTTP 200을 확인했다.
- 브라우저에서 1440px 데스크톱과 390px 모바일 시작 화면을 확인했다. 모바일 가로 넘침과 브라우저 실행 오류가 없었다. Pretendard는 패키지의 subset 파일을 자체 호스팅한다.
- 독립 코드 리뷰에서 중대한 문제가 없었으며 Python 생성 build 폴더의 Git/Docker 제외 누락을 보완했다.

현재 시작 화면은 준비 상태다. 실제 인증, 자료 등록, 일정 계산, 진도 저장과 AI는 구현하지 않았다. 다음 착수 지점은 Phase 1 Core Domain이며, 날짜 모델·계획 버전 계약과 DB/RLS 구현이 필요하다. 기존 미정 정책은 그대로 남아 있다.

도구 참고: pnpm 9에서 Node 24의 `url.parse` deprecation 경고가 발생한다. 실행 실패는 아니며 앱 lint/typecheck는 통과했다. ESLint는 Next.js 플러그인 peer 범위에 맞춰 9.x를 유지한다.

## 13. Phase 1 실행 기록 — 2026-09-13

Phase 0은 `30bfb4f`로 커밋했다. Phase 1 작업은 `feat/phase-1-core-domain`에서 진행했다.

- Auth User와 9개 업무 테이블을 `20260913000000_core_domain.sql` migration으로 구성했다. 소유자·자료를 포함한 복합 FK, RLS, 인덱스, 값 범위와 상태 enum을 정의했다.
- [DATABASE.md](DATABASE.md)에 날짜, 최초 진도, append-only 이력과 VOID 정정, 멱등성 키, 계획 버전 및 원자적 저장 경계를 기록했다. PRD의 UTC 날짜 규칙을 발생 시각과 지역 학습일로 구체화했다.
- 비로그인 Alice/Bob seed를 작성했다. 빈 로컬 DB에서 migration과 seed를 재현하고, seed 재실행이 중복 행을 만들지 않는 것을 확인했다.
- DB 타입을 shared로 생성하고 도메인 별칭을 연결했다. `pnpm db:types`와 `db:types:check`로 재생성 및 schema 일치를 검사한다.
- pgTAP **70개** 통과: 사용자 격리, 소유권 위조, 교차 자료 참조, 페이지·시간·목표 제약, 지역 날짜, 이력 보존, VOID와 계층 순환, 버전 CAS, 계정 삭제.
- 실제 Auth 토큰/REST 통합 테스트 통과: 데이터 격리, 소유권 위조 차단, 동시 CAS 한 건 반영, 중복 기록 한 건 저장, 임시 계정 정리.
- 별도 DB 연결 두 개로 외래키 잠금 승격 교착을 재현한 후 `FOR NO KEY UPDATE`로 수정했다. 회귀 테스트 통과.
- 코드 리뷰에서 발견한 bulk INSERT 순환 참조/VOID 참조 우회와 자료 단위 변경 불일치를 회귀 테스트로 재현하고 수정했다.
- `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, `supabase db lint --local`, `pnpm db:types:check`가 통과했다.

Phase 1은 영속화 계약이다. 실제 진도 projection, 중복 페이지·총량 검사, 일정 계산, 원자적 기록/재계획 RPC와 업무 UI는 후속 단계다. 상세 구현 경계는 DATABASE 문서를 따른다.

다음은 **Phase 2 Scheduler Engine**이다. Balanced 상한, 가용시간 제약, 속도 추정 정책을 확정한 뒤 Deadline/Pace/Balanced, 분량 보존과 완료일 예측을 순수 TypeScript 테스트로 구현한다.
