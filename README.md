# PaceOn

**Your learning, at your pace.**  
내 속도에 맞춰 계획하고, 자투리 시간에 공부하고, 배운 내용을 기록하는 개인 학습 웹앱입니다.

현재 **도서 학습 관리와 LR3 스피킹·쉐도잉까지 구현**되어 있습니다. Next.js 웹앱, Supabase의 인증·DB·비공개 파일 저장소, Python Worker로 구성됩니다.

## 주요 기능

| 기능 | 할 수 있는 일 |
| --- | --- |
| 도서·교재 라이브러리 | 직접 등록, Google Books·YES24 검색, PDF 페이지·목차 추출 후 등록 |
| 학습 계획 | 목표와 가용 시간에 따른 일정 생성, 진도 기록 후 재계획, 오늘 할 일·캘린더 |
| 간편 기록·통계 | 모바일에서 빠르게 학습 기록, 기간별 학습량·시간·활동일 확인 |
| AI 독서 도우미 | 도서 정보와 입력한 목차를 바탕으로 분석, 실제 진도에 따른 학습 코칭 |
| 영어 라이팅 | 영어학습에서 초안 작성·복원, AI 대화·첨삭·표현 정리 |
| YouTube 학습 | 링크 일괄 저장, 마지막 위치 이어보기, 배속·구간 반복, 시각별 메모와 자막 기반 질문 |
| 스피킹·쉐도잉 | AI 단문·모범 음성, 녹음·전사·표현 피드백, YouTube 5–30초 구간 연습 |
| 학습 타이머 | 일시 정지·종료, 실제 재생·녹음 시간 기록, 화면 숨김 시 자동 정지 |

영어학습에서는 버튼을 눌렀을 때만 AI로 내용을 전송합니다. 녹음은 분석 전에 기기에서 확인할 수 있고, 서버 음성은 기본 30일 보관하며 계속 보관하거나 삭제할 수 있습니다. 원래 인식 문장과 수정본을 구분하며 발음 점수는 제공하지 않습니다.

## 사용 흐름

1. 로그인 화면에서 이메일로 가입합니다. 확인 메일이 필요하면 로컬 테스트 메일함에서 확인합니다.
2. **라이브러리**에 교재를 등록하고 계획을 만들거나, **영어학습**에 YouTube 링크를 미리 저장합니다.
3. **이어서 공부하기**, **새 글 쓰기**, **스피킹 시작** 중 하나를 선택합니다.
4. 학습 중 메모·녹음·글을 남기고 필요한 시점에 AI 피드백을 요청합니다.
5. **학습 종료**로 시간을 확정하고 다음에 같은 공간에서 이어갑니다. 도서 기록은 **통계**에서 확인합니다.

자세한 사용법은 [영어학습 안내](docs/LEARNING_ROOM.md), [독서 기록](docs/QUICK_RECORD.md), [학습 통계](docs/STATISTICS.md)를 참고하세요.

## 준비

- Node.js **24.14.0** (`.node-version`), pnpm **9.15.0** (`packageManager`).
- Docker Desktop의 **Linux 엔진** 실행. Compose v2의 `include` 지원이 필요하다.
- Supabase CLI **2.116.0**으로 검증한 로컬 설정.
- Worker는 Docker의 **Python 3.13**을 사용한다. 호스트 Python 3.14를 설치할 필요가 없다.

Next.js 16.3.5, React 19.3.0, TypeScript 5.9.3, Tailwind 4.3.3을 사용한다. Next.js 플러그인의 peer 범위에 맞춰 ESLint 9.39.1을 고정했다. JS 의존성은 `pnpm-lock.yaml`, Worker 의존성은 `requirements.lock`으로 고정한다.

## 실행

아래 명령은 PowerShell 기준입니다. 처음 내려받을 때:

```powershell
git clone https://github.com/gnghkim/paceon.git
cd paceon
pnpm install --frozen-lockfile
docker info
supabase start
supabase migration up --local
Copy-Item apps/web/.env.example apps/web/.env.local
supabase status
```

`supabase status`에서 확인한 로컬 publishable key를 **apps/web/.env.local**의 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`에 입력합니다. URL은 기본값 `http://127.0.0.1:55321`을 사용합니다. 이미 환경 파일이 있다면 복사하지 말고 필요한 항목만 수정합니다.

그다음 웹앱을 실행합니다.

```powershell
pnpm dev
```

AI·PDF 없이도 직접 도서 등록, 학습 계획·기록, YouTube 링크 저장과 재생을 사용할 수 있습니다. AI와 PDF 처리는 아래 Worker 설정을 추가합니다. `supabase start`가 Supabase 스택을 관리하고, Docker Compose는 Worker를 관리합니다.

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

| 파일 | 설정 |
| --- | --- |
| `apps/web/.env.local` | Supabase 공개 URL·publishable key, 웹의 AI/PDF 활성화, 선택적 도서 검색·YouTube OAuth 설정 |
| `services/ai-worker/.env` | Supabase 서비스 역할 키, OpenAI 키·모델, Worker의 AI/PDF 활성화 |
| `.env.example` | 루트의 참고 목록. Next.js가 읽는 실제 설정 파일은 아님 |

### AI·PDF Worker

```powershell
Copy-Item services/ai-worker/.env.example services/ai-worker/.env
```

Worker 파일에 필요한 값을 입력합니다.

```dotenv
SUPABASE_URL=http://host.docker.internal:55321
SUPABASE_SERVICE_ROLE_KEY=<로컬 Supabase service_role 키>
AI_ENABLED=true
OPENAI_API_KEY=<OpenAI API 키>
OPENAI_MODEL=gpt-5.4-mini
PDF_ENABLED=true
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=marin
```

`OPENAI_MODEL`은 이 프로젝트에서 실제 연동을 확인한 설정 예시이며, 계정에서 사용할 수 있는 Responses API 구조화 출력 지원 모델로 바꿀 수 있습니다. PDF만 사용할 때는 `AI_ENABLED=false`로 두고 OpenAI 키 없이 실행할 수 있습니다.

```powershell
docker compose --env-file services/ai-worker/.env -f docker/docker-compose.yml up -d --build
```

Worker가 실행되면 웹의 `apps/web/.env.local`에서도 사용할 기능의 `AI_ENABLED=true`, `PDF_ENABLED=true`를 설정하고 웹 서버를 재시작합니다. 웹 스위치만 켜면 Worker가 처리하지 못한 요청이 대기 상태로 남을 수 있습니다.

### 선택적 외부 연동

- **YES24**: `apps/web/.env.local`의 `YES24_API_KEY`에 입력합니다. Google Books 키는 같은 파일의 `GOOGLE_BOOKS_API_KEY`입니다.
- **YouTube 계정**: [Google 프로젝트·OAuth 설정 안내](docs/YOUTUBE_SETUP.md)에 따라 설정합니다. 계정 연결 없이도 영상 링크 저장과 재생은 가능합니다.
- **비밀 값**: OpenAI 키는 Worker에만 둡니다. YouTube OAuth를 설정할 때 필요한 웹 서버 전용 서비스 키·클라이언트 시크릿에도 `NEXT_PUBLIC_`를 붙이지 않습니다. 실제 환경 파일과 CLI의 키 출력은 Git에 포함하지 않습니다.

세부 설정은 [AI](docs/AI.md), [PDF](docs/PDF.md), [영어학습](docs/LEARNING_ROOM.md) 문서를 참고하세요.

## 검증

```powershell
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm db:test
pnpm db:types:check
pnpm test:ai:worker
# 빌드 및 Supabase Local 준비 후:
pnpm test:books:integration
pnpm test:learning:integration
# Supabase Local과 AI Worker가 실행 중일 때:
pnpm test:speech:integration
pnpm db:test:api
pnpm db:test:locks
# 웹과 Worker가 실행 중일 때:
pnpm test:smoke
docker compose ps
docker compose exec -T ai-worker pip check
supabase status
docker exec supabase_db_PaceOn pg_isready -U postgres
```

`pnpm test`는 도서 입력·Provider·API 테스트와 scheduler 독립 import, Vitest 일정 계산 테스트를 실행한다. DB·Docker·웹 서버 없이 실행 가능하다. `test:books:integration`은 빌드 후 Supabase Local과 임시 프로덕션 서버에서 실제 인증·도서 등록·격리를 확인하고 테스트 계정을 삭제한다. `pnpm --filter @paceon/scheduler test`로 엔진만 검사할 수 있다. `test:smoke`는 실제 HTTP 응답 상태·JSON 계약을 검사한다. 필요하면 `WEB_HEALTH_URL`과 `WORKER_HEALTH_URL`로 주소를 바꿀 수 있다.

영어학습 API·YouTube·음성 요청·단어 비교도 `pnpm test`에 포함됩니다. `test:learning:integration`은 실제 Auth와 LR1/LR2 경로를, `test:speech:integration`은 실제 Storage 업로드·재시도·격리·음성 삭제를 검증합니다. 영어학습 통합 검사는 AI 큐에 요청을 접수하므로 실제 Worker가 켜져 있으면 제공자 호출이 발생할 수 있습니다. 음성 통합 검사는 잘못된 오디오를 사용해 제공자 호출 전에 거절되는지 확인합니다.

LR3 구현 시 웹/스케줄러 **178개**, Worker **50개**, DB **384개** 검사와 실제 OpenAI 음성 생성·전사·피드백 저장을 확인했습니다. 이는 당시 검증 결과이며 현재 변경의 검증은 위 명령으로 수행합니다.

`db:test`는 실제 PostgreSQL에서 RLS·외래키·입력 제약·이력 보존·계획 버전을 검증하고 rollback한다. `db:test:api`는 임시 Auth 사용자 두 명을 생성해 실제 토큰으로 REST 격리와 동시 쓰기를 검증한 뒤 계정을 삭제한다. 이 명령은 localhost Supabase만 허용하며 키를 파일이나 로그에 출력하지 않는다.

`db:test:locks`는 Docker의 `supabase_db_PaceOn`에 두 DB 연결을 열어 외래키 잠금이 이미 잡힌 상황에서도 서로 다른 진도 기록을 동시에 삽입할 수 있는지 확인한다. 테스트용 계정과 자료는 종료 시 제거한다.

개발 seed가 필요하면 `pnpm db:reset`을 실행한다. **PaceOn 로컬 DB 데이터를 삭제하고 migration·seed로 재생성**하므로 개인 데이터를 저장한 이후에는 먼저 보관한다. seed는 로그인할 수 없는 Alice/Bob fixture이며 비밀번호를 포함하지 않는다. DB 변경 후 `pnpm db:types`로 공통 타입을 재생성한다.

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
apps/web              인증 · Today/서재/캘린더 · 도서/계획 API · 디자인 토큰
packages/books        도서 검증 · Google Books/Manual/YES24 Provider
packages/shared       공통 타입
packages/scheduler    일정 생성·재계획·속도 추정 · Vitest
packages/ai-schema    AI 작업 입력·결과 검증
packages/pdf-schema   PDF 처리 한도·결과·확인 입력 검증
services/ai-worker    FastAPI · AI/PDF/음성 작업 소비자 · 격리 PDF·오디오 파서
supabase              도메인 migration · 비로그인 개발 seed · pgTAP 테스트
docker                Worker Compose
tests                 패키지 import · health HTTP · Auth/REST 격리·동시성 테스트
docs                  요구사항 · 설계 · 구현 준비 및 실행 계획
```

다음 단계는 **LR4 표현 저장·복습·영어학습 통계 통합**, 이후 **LR5 추천·PWA**입니다. 확장 범위는 [영어학습 명세서](docs/LEARNING_ROOM_SPEC.md)에 정리되어 있습니다.

현재 제한:

- YouTube OAuth 실제 계정 검증은 Google 프로젝트 설정 후 필요합니다. 계정 연결만으로 Premium 적용·광고 제거·전체 시청 기록 동기화를 보장하지 않습니다.
- YouTube 자동 자막 수집, PDF OCR, 오프라인 PWA는 구현하지 않았습니다.
- 영어학습 기록은 기존 도서 페이지 진도·통계에 아직 합산하지 않습니다.
- 모바일 크기의 브라우저와 테스트 마이크를 검증했으며, 실제 iOS/Android 마이크·권한 동작은 추가 검증이 필요합니다.
- AI 응답은 저장된 작업을 처리한 뒤 조회하는 방식이며 토큰 스트리밍은 지원하지 않습니다.

개발 문서: [영어학습](docs/LEARNING_ROOM.md) · [통계](docs/STATISTICS.md) · [PDF](docs/PDF.md) · [AI](docs/AI.md) · [도서](docs/BOOKS.md) · [스케줄러](docs/SCHEDULER.md) · [데이터베이스](docs/DATABASE.md) · [아키텍처](docs/ARCHITECTURE.md) · [제품 요구사항](docs/PRD.md) · [디자인](docs/DESIGN.md).

## 라이선스

[MIT](LICENSE)
