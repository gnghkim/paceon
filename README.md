# PaceOn

**Your learning, at your pace.**  
내 속도에 맞춰 계속 다시 짜주는 학습 계획.

현재 범위는 **Phase 0 Foundation**이다. 한국어 시작 화면, 독립 패키지와 프로세스 health check를 제공한다. 인증 UI, 자료 등록, 일정 계산, 실제 AI 분석은 후속 단계에서 구현한다.

## 준비

- Node.js **24.14.0** (`.node-version`), pnpm **9.15.0** (`packageManager`).
- Docker Desktop의 **Linux 엔진** 실행. Compose v2의 `include` 지원이 필요하다.
- Supabase CLI **2.116.0**으로 검증한 로컬 설정.
- Worker는 Docker의 **Python 3.13**을 사용한다. 호스트 Python 3.14를 설치할 필요가 없다.

Next.js 16.3.5, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3을 사용한다. Next.js 플러그인의 peer 범위에 맞춰 ESLint 9.39.1을 고정했다. JS 의존성은 `pnpm-lock.yaml`, Worker 의존성은 `requirements.lock`으로 고정한다.

## 실행

저장소 루트에서:

```powershell
docker info
supabase start
docker compose up -d --build
pnpm install --frozen-lockfile
pnpm dev
```

최초 실행은 컨테이너 이미지와 패키지를 내려받아 시간이 걸린다. `supabase start`가 Supabase 전체 스택을 관리하고, `docker compose`는 Worker를 관리한다. 루트 `compose.yaml`이 `docker/docker-compose.yml`을 포함하므로 루트에서 명령을 실행할 수 있다. `docker compose -f docker/docker-compose.yml up -d --build`도 동일하게 동작한다.

| 서비스 | 주소 |
| --- | --- |
| 웹 | http://localhost:3000 |
| 웹 health | http://localhost:3000/api/health |
| Worker health | http://localhost:8000/health |
| Worker API 문서 | http://localhost:8000/docs |
| Supabase API | http://127.0.0.1:55321 |
| Supabase Studio | http://127.0.0.1:55323 |
| 테스트 메일함 | http://127.0.0.1:55324 |
| PostgreSQL | 127.0.0.1:55322 |

PaceOn은 다른 로컬 Supabase 프로젝트와 공존하도록 **553xx** 포트를 사용한다. Shadow DB는 55320, 비활성 pooler는 55329, Edge debugger는 18083이다.

Windows에서 기본 Vector 로그 수집기가 `host.docker.internal:2375`에 연결하지 못해 반복 종료되는 것을 확인했다. 이 프로젝트에서는 선택 기능인 `[analytics]`를 비활성화했다. DB, Auth, Storage, Realtime, Studio는 그대로 실행되며 **Studio의 중앙 로그 수집은 제공하지 않는다**.

## 환경변수

Phase 0은 키 없이 실행된다. Supabase를 웹에 연결하는 단계에서:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
supabase status
```

출력의 로컬 URL과 publishable key를 `.env.local`에 입력한다. 루트 `.env.example`은 환경변수 목록 안내용이며, Next.js가 읽는 파일은 **apps/web/.env.local**이다. `SUPABASE_SECRET_KEY`는 서버 전용이며 필요할 때만 설정한다. 비밀 키에 `NEXT_PUBLIC_` 접두사를 붙이지 않는다. 실제 `.env`와 CLI 출력 로그는 Git에서 제외한다. Worker skeleton은 외부 키를 사용하지 않는다.

## 검증

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm test
# 웹과 Worker가 실행 중일 때:
pnpm test:smoke
docker compose ps
docker compose exec -T ai-worker pip check
supabase status
docker exec supabase_db_PaceOn pg_isready -U postgres
```

`pnpm test`는 Node 24의 TypeScript 지원으로 scheduler를 독립 import한다. 웹 빌드도 `@paceon/scheduler`와 `@paceon/shared` workspace 경계를 검사한다. `test:smoke`는 실제 HTTP 응답 상태·JSON 계약을 검사한다. 필요하면 `WEB_HEALTH_URL`과 `WORKER_HEALTH_URL`로 주소를 바꿀 수 있다.

두 health endpoint의 `check: "liveness"`는 해당 프로세스가 응답한다는 의미다. DB 연결이나 AI 제공자 준비 상태를 보장하지 않는다. DB 준비 상태는 별도 명령으로 확인한다.

프로덕션 실행 확인은 `pnpm build` 후 `pnpm --filter @paceon/web start`를 사용한다. 개발 서버와 동일한 3000 포트를 쓰므로 먼저 개발 서버를 종료한다.

## 종료

웹 터미널에서 `Ctrl+C`를 누른 뒤:

```powershell
docker compose down
supabase stop
```

이 명령은 PaceOn 프로젝트를 대상으로 하며 Supabase 로컬 데이터는 보존한다.

## 구조와 다음 단계

```text
apps/web              Next.js 시작 화면 · 웹 health · 디자인 토큰
packages/shared       공통 타입
packages/scheduler    프레임워크 독립 TypeScript 패키지
services/ai-worker    FastAPI skeleton · Python 의존성 잠금 · Dockerfile
supabase              로컬 설정 · 빈 seed (업무 스키마는 Phase 1)
docker                Worker Compose
tests                 패키지 import · 실제 HTTP smoke test
docs                  요구사항 · 설계 · 구현 준비 및 실행 계획
```

다음 단계는 Phase 1 Core Domain: 날짜·계획 버전 계약, DB 모델, migration, seed, RLS와 사용자 간 격리 검증이다. 제품 기준은 [PRD](docs/PRD.md), 화면 기준은 [DESIGN](docs/DESIGN.md), 책임 경계는 [ARCHITECTURE](docs/ARCHITECTURE.md)를 따른다.

의존성 구성 참고: [Next.js 설치](https://nextjs.org/docs/app/getting-started/installation), [Tailwind Next.js 설정](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [FastAPI Docker 구성](https://fastapi.tiangolo.com/deployment/docker/).
