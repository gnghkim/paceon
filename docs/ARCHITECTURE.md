# PaceOn Architecture

## Phase 0 경계

웹은 호스트에서 실행하는 Next.js App Router다. 한국어 Light UI, Pretendard 자체 호스팅 subset, Tailwind 의미 토큰과 shadcn의 `components.json`·`cn` 기반을 갖춘다. 시작 화면은 준비 상태를 표시한다. 앱 업무 화면이나 작동하지 않는 등록 버튼을 제공하지 않는다.

`@paceon/shared`는 `PlanMode`, `HealthResponse` 타입만 제공한다. `@paceon/scheduler`는 shared의 타입에만 의존하고, 현재 `schedulerContract`로 패키지 연결을 검증한다. 이 객체는 일정 생성 알고리즘의 구현 또는 준비 완료를 의미하지 않는다. 패키지는 workspace에서 TypeScript 소스를 export하며 Next.js는 `transpilePackages`로 처리한다. `build`는 별도 JS와 선언 파일도 생성한다. React, Next.js, Supabase, AI 런타임에 의존하지 않는다.

Worker는 Python 3.13 / FastAPI / Pydantic / Uvicorn으로 구성한다. 비특권 사용자로 실행하고 호스트의 127.0.0.1:8000에만 포트를 공개한다. Phase 6에서 설정된 경우 PostgreSQL AI 작업 큐를 소비하고 구조화된 도서 분석·코칭 결과를 저장한다. 외부 HTTP에는 생존 확인만 제공하며 작업 접근은 서비스 역할 RPC로 인증한다. PDF 처리는 후속 범위다.

Supabase CLI는 Auth, PostgreSQL 17, Storage, Realtime, Edge runtime과 Studio를 관리한다. Compose에 Supabase를 중복 정의하지 않는다. 다른 로컬 프로젝트와 충돌을 피하도록 553xx 포트를 사용한다. Windows Docker TCP 의존성이 있는 선택적 analytics 로그 수집은 꺼져 있다. 이 설정은 제품 AI 분석 기능과 별개다.

## 실행 및 검증 경계

```text
Browser -> Next.js :3000 -> 정적 시작 화면
                       -> /api/health (웹 liveness)

Host -> Docker Worker :8000/health (Worker liveness)
Host -> Supabase :55321 API / :55322 DB / :55323 Studio
```

현재 웹은 DB·Worker에 요청하지 않는다. 외부 연결을 확인하지 않고 health 결과에 ready 상태를 표시하지 않는다. 실제 HTTP smoke test와 DB `pg_isready`, Auth health 요청을 별도로 검증한다. 외부 API 키는 Phase 0의 설치·빌드·실행에 필요하지 않다.

## 후속 도메인 흐름

```text
Resource + Goal + AvailabilityRule
  -> Plan -> ScheduleSession
  -> ProgressEvent -> 집계
  -> ReplanRun -> 미래 미완료 ScheduleSession
```

Phase 1에서 DB 관계·제약·RLS·멱등성·계획 버전 계약을 정의했다. 사용자 학습일과 UTC 발생 시각을 분리하는 모델도 PRD에 명시했다. Phase 2에서 결정론적 scheduler의 날짜 입력, 분량 보존, 고정/과거/완료 세션 보존, 모드별 불가능 상태와 Balanced 정책을 구현한다.

`packages/ai-schema`는 Phase 6 AI 입력 타입과 엄격한 Zod 출력 검증을 제공한다. Python Worker는 같은 계약을 Pydantic으로 검증한다. 상세 구조와 제한은 [AI](AI.md)를 따른다.

## 의존성 관리

- JS: `packageManager`, `.node-version`, 정확한 직접 의존성과 `pnpm-lock.yaml`.
- Python: `pyproject.toml`의 직접 의존성, Python 3.13 컨테이너에서 해석한 전체 `requirements.lock`. Docker는 lock을 설치한다.
- Python lock 갱신은 깨끗한 Python 3.13 환경에서 `pip install .` 후 `pip freeze`로 생성하며 로컬 프로젝트의 `paceon-ai-worker @ file:...` 행은 제거한다. `pip check`와 컨테이너 health를 재검증한다.
- Python 이미지 태그는 `3.13-slim`으로 보안 패치 수신을 허용한다. 바이트 단위 이미지 재현이 필요하면 배포 단계에서 검증한 digest를 고정한다.
- Next.js 개발 서버가 생성한 `apps/web/AGENTS.md`와 `CLAUDE.md`는 해당 버전의 번들 문서 확인 지침이다.

## Phase 1 추가 — Core Domain

Auth의 User와 9개 public 테이블을 migration으로 정의한다. 모든 업무 데이터는 user_id로 소유하고, 복합 FK로 사용자·자료가 서로 다른 연결을 차단한다. authenticated RLS와 이력 테이블의 SELECT/INSERT 전용 권한을 함께 사용한다.

shared의 도메인 타입은 DB schema에서 생성한 TypeScript 타입을 참조한다. scheduler는 여전히 타입에만 의존하며 DB 접근 코드를 포함하지 않는다. DB 스키마 생성 파일도 프레임워크 런타임 의존성이 없다.

이 단계에서 추가한 계약은 지역 학습일과 UTC 발생 시각 분리, 최초 완료 분량 보존, append-only 진도/무효화 기록, 계획 버전 CAS, 재계획 전후 이력이다. 자세한 제약과 후속 transaction 경계는 [DATABASE](DATABASE.md)에 기록한다.

웹은 사용자 Auth 토큰으로 RLS가 적용된 DB를 조회한다. 도서 등록, 최초 계획, Phase 5 기록·재계획 RPC를 연결했으며 pgTAP와 실제 Auth/HTTP 통합 테스트로 검증한다.

## Phase 2 추가 — Scheduler Engine

`packages/scheduler`는 dates, speed, types, scheduler 모듈로 구성한다. `scheduleBook`, `replanBook`, `scheduleBooks`, `estimateReadingSpeed`, `toStudyDate`를 공개한다. 알고리즘 계약 버전은 `book-scheduler-v1`이며 DB의 plan revision과 구분한다.

단일 책의 연속 완료 지점을 입력받아 남은 페이지를 계산하고, 모드·요일·시간·외부 예약·보존 세션에 따라 순수 결과를 반환한다. 복합 계획은 배열 순서의 명시적 우선순위로 공통 시간 예산을 공유한다. 실제 DB 기록의 projection이나 저장 transaction을 이 모듈에서 수행하지 않는다.

날짜는 명시적인 달력 날짜를 UTC 기반 정수 일자로 변환해 계산하므로 DST 때문에 하루가 누락되지 않는다. 현재 시각은 내부에서 읽지 않는다. 속도는 명시적 기간의 신규 페이지 표본에서만 추정하며 AI 호출이 없다.

실패 결과는 충돌 코드와 보존 세션만 포함한다. 부분 계산된 세션을 반환하지 않아 후속 저장 계층이 실수로 일부 일정만 적용하는 경로를 줄인다. Phase 5의 검증·잠금·원자적 RPC가 실제 기록을 저장하고 성공한 일정만 적용한다. 세부 정책과 한계는 [SCHEDULER](SCHEDULER.md)를 따른다.
