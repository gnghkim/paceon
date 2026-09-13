# Phase 6 — 도서 분석과 학습 코칭

자료 상세의 **AI 독서 인사이트**에서 도서 분석 또는 학습 코칭을 요청한다. 도서 분석에는 목차를 선택적으로 붙여 넣을 수 있다. 분석은 난이도·책 전체 예상 시간·중요도·신뢰도·판단 근거를 제공하며, 코칭은 현재 진도와 최근 7일 유효 읽기 기록을 설명한다. 결과는 참고용 추정이다. 실제 계획 속도·목표·일정·진도를 자동 변경하지 않는다.

현재 저장된 도서에는 저자 문자열과 제목·페이지 수가 있으며 책 소개 본문은 저장하지 않는다. 목차가 없으면 이 제한된 정보만 분석한다. 실제 본문을 읽었다고 표현하거나 이해도·속도 향상 추세를 만들어 내지 않도록 프롬프트를 제한한다. 사용자가 입력한 목차는 분석 요청 시 외부 AI 제공자에게 전달된다. 개인 메모·이메일·인증 토큰은 AI 입력에 포함하지 않는다.

## 실행 설정

1. `supabase migration up --local`로 `20260916000000_ai_jobs.sql`까지 적용한다.
2. [Worker 예제 설정](../services/ai-worker/.env.example)을 같은 디렉터리의 `.env`로 복사한다. `AI_ENABLED=true`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`을 설정한다. 모델은 Responses API의 strict structured outputs를 지원하는 모델을 명시한다.
3. 저장소 루트에서 `docker compose --env-file services/ai-worker/.env -f docker/docker-compose.yml up --build -d`를 실행한다. Docker에서 로컬 Supabase 주소는 `http://host.docker.internal:55321`이다.
4. Worker 설정 후 `apps/web/.env.local`에 `AI_ENABLED=true`를 추가하고 웹 서버를 다시 시작한다. 웹에는 OpenAI 키나 Supabase 서비스 키를 설정하지 않는다.

미설정 기본값은 비활성이다. 이때 화면은 AI를 사용할 수 없다고 알리고 도서 등록·진도 기록·계획은 정상 동작한다. 웹의 `AI_ENABLED`는 운영자가 설정하는 기능 스위치이며 Worker의 실제 연결 상태를 증명하는 health check가 아니다. Worker의 `/health`도 프로세스 생존 여부만 확인한다. Worker 없이 웹 스위치만 켜면 작업이 대기 상태로 남는다.

## API와 저장

두 endpoint 모두 `Authorization: Bearer <access token>`으로 본인 도서만 접근한다. 응답은 `no-store`다.

- `GET /api/resources/books/{id}/ai`: 이용 가능 여부, 종류별 현재 정보 버전, 각 종류의 최근 작업 10개를 반환한다. 작업을 새로 만들지 않는다.
- `POST /api/resources/books/{id}/ai`: `{ "kind": "BOOK_ANALYSIS", "outline": "선택 목차" }` 또는 `{ "kind": "COACH" }`. 요청 JSON은 64KiB, 목차는 12,000자 이하다. 새/진행 중 작업은 202, 동일 정보의 완료 결과 재사용은 200이다.
- 인증 오류 401, 없는/타인 도서 404, 잘못된 입력 400, 큐 한도 초과 429, 비활성/연결 오류 503이다.

서버가 소유 자료와 유효 이벤트를 읽어 결정론적 요약을 만들고 SHA-256 정보 버전을 붙인다. 결과 생성 이후 진도·계획·날짜·분석 입력이 달라지면 이전 정보 결과로 표시한다. 기존 결과는 실패나 새 분석 대기 중에도 남아 있다. UI 자동 확인은 최대 10분이며 이후 상태 다시 확인을 제공한다.

PostgreSQL `ai_jobs`를 영속 큐로 사용한다. 본인 작업 조회만 RLS로 허용하며, 입력 생성은 인증된 `enqueue_ai_job` RPC를 사용한다. 동일 도서/종류의 진행 중 작업은 하나만 생성한다. 동일 정보로 이미 완료된 작업도 재사용한다. 사용자당 진행 중 작업은 5개까지다. 실패한 요청은 다시 요청할 수 있다.

Worker만 서비스 역할로 `claim_ai_job`과 `finish_ai_job`을 호출한다. `FOR UPDATE SKIP LOCKED`로 작업을 가져오고 120초 lease와 무작위 lease 토큰으로 결과를 저장한다. Worker 중단으로 만료된 작업은 최대 3회 처리 시도 후 `WORKER_TIMEOUT`으로 실패한다. 이전 Worker는 만료되거나 재발급된 lease로 결과를 덮어쓸 수 없다. 제공자 오류/거절/잘못된 응답은 안전한 오류 코드만 저장한다. 중단 직전에 제공자 호출이 끝났으나 결과 저장이 실패한 경우 lease 재시도로 제공자 호출이 반복될 수 있다.

모델명·제공자 응답 ID·입출력 토큰 수를 결과와 함께 저장한다. Web API는 작업 입력·lease·제공자 응답 ID·토큰 정보를 노출하지 않는다. OpenAI 호출은 고정된 Responses URL, `store:false`, 도구 없이 strict JSON Schema 형식을 사용한다. Pydantic, SQL 제약, 웹 Zod 검증을 거친 결과만 표시한다. 실제 과금액은 계산하지 않는다.

## 검증

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:test`, `pnpm db:types:check`, `supabase db lint --local`을 실행한다.

Worker 이미지를 빌드한 뒤 `pnpm test:ai:worker`로 Python 테스트를 실행한다. `pnpm test:ai:integration`은 프로덕션 Next와 실제 로컬 Auth/DB, 실제 Python Worker 경로를 연결한다. 외부 제공자 응답만 테스트 fixture로 대체한다. 큐가 비어 있고 다른 Worker가 작업을 소비하지 않는 로컬 환경에서 실행하며 임시 사용자를 삭제한다.

실제 OpenAI 키가 없는 상태에서 구현했으므로 유료 모델 실호출과 분석 품질은 아직 검증하지 않았다. 테스트 응답은 테스트 전용 도구에만 있으며 운영 Worker에 가짜 결과 모드가 없다.

브라우저에서는 미설정 안내와 분석/코칭 대기·완료·실패·재시도를 확인했다. 실제 읽기 기록을 저장한 뒤 기존 AI 결과가 이전 정보로 표시되는 것을 확인했고, 390px 모바일에서 가로 넘침과 실행 오류가 없었다.

PDF 업로드·파싱, 세부 학습단위 분석, mastery 평가, 자유 대화 Coach는 후속 범위다. 이 단계의 Coach는 자료별 짧은 설명 카드다.
