# Phase 1 Core Domain Implementation Plan

**Goal:** migration으로 재현 가능한 학습 도메인, 사용자 격리, 이력 보존과 공통 DB 타입을 제공한다.
**Architecture:** Supabase Auth를 User로 사용하고 public에 9개 업무 테이블을 구성한다. 모든 관계는 user_id와 필요 시 resource_id를 포함한 복합 FK로 보호한다. RLS는 authenticated 소유 행에만 접근을 허용한다.
**Tech Stack:** PostgreSQL 17, Supabase migrations / pgTAP, generated TypeScript.

기존 Phase 1 진행 지시에 따라 현재 작업 폴더의 별도 브랜치에서 수행한다. 준비 문서의 날짜·초기 진도·계획 버전 계약은 이번 단계에서 구체화한다.

- [x] 문서: `docs/DATABASE.md`, PRD 날짜 규칙과 이력 계약. UTC 발생 시각과 지역 학습일 분리, 단일 자료 계획, 사용자별 가용 요일, 버전 CAS 계약 정의.
- [x] RED: `supabase/tests/database/core_domain.test.sql`에서 스키마 존재 검증 실패 확인. 이어 두 사용자 fixture 기반 CRUD RLS·관계 참조·수치 제약·불변 이력·계획 버전 검증 작성.
- [x] Migration: `supabase/migrations/20260913000000_core_domain.sql`에 Resource, ResourceUnit, Goal, Plan, AvailabilityRule, ScheduleSession, ProgressEvent, ReplanRun, LearnerProfile과 인덱스·RLS·트리거 작성.
- [x] Seed: `supabase/seed.sql`에 비로그인 개발 fixture 두 사용자와 각 도메인 예제 작성. 실제 비밀번호나 키 없음. seed 반복 실행 가능.
- [x] GREEN: 빈 PaceOn Local DB에서 `supabase db reset --local` 후 `supabase test db` 실행. 테스트는 transaction rollback으로 데이터 보존.
- [x] 타입: DB에서 `packages/shared/src/database.types.ts` 생성, 공통 도메인 타입 export. CLI stdout만 UTF-8로 저장하는 재생성 스크립트 추가.
- [x] 검증: DB 재생성 및 tests 반복, 실제 Auth 토큰을 쓰는 HTTP 격리 smoke, pnpm typecheck/test/build. 코드 리뷰 후 필요한 수정 반영.
- [x] 문서: README와 구현 준비 문서에 완료 범위·명령·다음 Phase 기록.

Phase 1은 scheduler 또는 사용자 입력 API를 구현하지 않는다. 진도 저장과 재계획 적용을 묶는 최종 RPC는 Phase 5에서 구현하되, 하나의 DB transaction과 Plan row lock / expected version 검증을 사용하도록 계약한다. schema 단계에서 이력 수정 차단, 중복 키·관계 제약, 행 수정 시 버전 증가를 보장한다.
