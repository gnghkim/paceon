# Phase 2 Scheduler Implementation Plan

**Goal:** 책의 남은 연속 페이지를 날짜·요일·시간 제약에 맞춰 배분하는 결정론적 TypeScript 엔진.
**Architecture:** dates / speed / types / scheduler 모듈로 분리한다. DB, React, Next.js, AI와 현재 시각 읽기에 의존하지 않는다. 보존 세션과 여러 자료의 예약 시간을 명시 입력으로 받는다.
**Tech Stack:** TypeScript, Vitest, 기존 @paceon/shared PlanMode.

- [x] `docs/SCHEDULER.md`와 PRD에 모드·가용시간·속도 표본·보존 계약 작성.
- [x] Vitest 설치, 수용 예시와 실패·보존 테스트를 작성하고 RED 확인.
- [x] `src/dates.ts`, `src/speed.ts`, `src/types.ts`, `src/scheduler.ts` 구현.
- [x] 단일 책 생성 및 재계획, 사용자 공통 일일 시간 예산, 고정 분량 제외와 충돌 처리를 검증.
- [x] 윤년/시간대/경계 날짜와 불가능한 일정, 결정론·불변성·분량 보존 검증.
- [x] 독립 코드 리뷰와 회귀 수정. `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` 실행.
- [x] README와 구현 준비 문서에 실제 완료 범위·후속 연결 지점 기록.

최종 DB 저장 RPC와 UI는 후속 Phase이며 이번 단계에서는 순수 계산 결과와 변경 설명만 반환한다.
