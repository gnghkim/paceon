# Phase 0 Foundation Implementation Plan

**Goal:** 로컬에서 실행 가능한 PaceOn 기반과 재현 가능한 검증 명령을 만든다.
**Architecture:** 기존 IMPLEMENTATION_READINESS의 Phase 0 설계를 따른다. 호스트 Next.js, 독립 TypeScript 패키지, CLI 관리 Supabase, Compose 관리 FastAPI로 분리한다.
**Tech stack:** Node 24, pnpm 9, Next.js App Router, Tailwind 4, TypeScript, Python 3.13, FastAPI, Supabase.

기존 준비안에 대한 계속 진행 지시를 기준으로 현재 세션에서 순차 실행한다. 업무 기능과 미정 정책은 후속 Phase 범위다.

- [x] 기반: 루트 package.json, pnpm-workspace.yaml, tsconfig.base.json, .gitignore와 런타임 버전 파일 작성. 패키지 버전은 registry에서 확인하고 lockfile로 고정.
- [x] 패키지: packages/shared에 계획 모드 타입, packages/scheduler에 독립 패키지 export 구성. 웹에서 실제 import해 빌드 경계를 검증.
- [x] 웹: apps/web에 App Router, 한국어 시작 화면, Tailwind 의미 토큰, shadcn 설정과 /api/health 구현. health는 프로세스 생존만 의미.
- [x] Worker: services/ai-worker에 pyproject.toml, 잠금 의존성, /health와 Dockerfile 작성. 외부 서비스 없이 응답.
- [x] 인프라: docker/docker-compose.yml과 루트 compose 진입점 작성. Supabase 기존 config 유지, 빈 seed 추가. .env.example에 공개값과 서버 전용값 구분.
- [x] 검증: pnpm install --frozen-lockfile, pnpm typecheck, pnpm lint, pnpm build, pnpm test 실행. Docker Compose build/up, Supabase start 및 실제 HTTP와 브라우저 확인.
- [x] 인계: README.md, docs/ARCHITECTURE.md와 준비 문서에 실행 순서, 확인 결과, 남은 제한 기록.

설정과 정적 시작 화면에는 구현을 그대로 반복하는 단위 테스트를 추가하지 않는다. 패키지 import와 실제 HTTP 응답 계약은 통합 smoke test로 확인한다.
