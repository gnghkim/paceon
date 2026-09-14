# Phase 7 — PDF 가져오기

서재 또는 도서 등록 화면에서 **PDF 가져오기**를 열고 파일을 선택한다. 업로드가 끝나면 Worker가 페이지 수·책갈피·본문 일부를 추출한다. 결과의 제목과 현재 읽은 페이지를 확인해 서재에 등록하면 기존 계획 생성·진도 기록·자동 재계획을 사용할 수 있다.

PDF는 기존 페이지 스케줄러와 호환되는 `BOOK`/`PAGE` 자료로 저장하며 `source=PDF_IMPORT`와 화면의 PDF 표시로 출처를 구분한다. 임의의 도서 페이지 수로 먼저 등록하지 않고 추출 완료 후 확인 트랜잭션에서 자료와 학습 단원을 함께 만든다.

## 처리 범위

- 최대 **10MiB**, **500페이지**의 PDF를 지원한다. PDF 헤더와 실제 바이트 수를 검사한다.
- 유효한 최상위 PDF 책갈피를 페이지순으로 정리하고 다음 책갈피 전까지를 하나의 단원으로 만든다. 앞부분이 있으면 별도 단원으로 포함한다. 전체 페이지가 빈틈·중복 없이 포함되어야 한다.
- 책갈피가 없거나 사용할 수 없으면 전체 문서를 단원 하나로 만든다. 본문에서 임의의 제목을 추측하지 않는다.
- 처음 최대 10페이지에서 본문 일부를 추출한다. 본문 미리보기와 AI 입력용 목차·본문 발췌는 각각 최대 12,000 UTF-16 단위이며, 잘린 경우 부분 추출임을 알린다. NUL과 잘못된 Unicode는 저장 가능한 대체 문자로 정규화한다.
- 텍스트가 없는 스캔 문서도 페이지 수로 등록할 수 있지만 OCR은 제공하지 않는다. 암호화된 PDF는 빈 비밀번호 문서도 거절한다. 손상·용량·페이지 초과·처리 제한 오류를 구분한다.

자료 상세에서 단원과 원본 파일을 확인할 수 있다. 원본은 인증된 요청으로 내려받으며 강제 다운로드·`nosniff`·`no-store` 헤더를 사용한다. 추출한 목차와 본문 발췌는 AI 카드의 초기 입력으로 제안하며 사용자가 수정하거나 비울 수 있다. **AI 분석 요청 버튼을 누를 때만** 외부 모델에 전달된다. PDF 처리 자체는 OpenAI 키가 필요 없다.

## 비공개 저장과 복구

Supabase Storage의 `learning-pdfs` 버킷은 비공개다. 객체 경로는 `사용자 UUID/가져오기 UUID.pdf`이며 서버가 결정한다. 업로드 본인만 조회·삽입·정리할 수 있고 객체 덮어쓰기는 허용하지 않는다. 웹 서버는 사용자 토큰으로 저장소에 접근하고 Worker만 서비스 역할을 사용한다.

업로드 요청 ID에 파일 이름·바이트 수·SHA-256을 결합해 동일 요청 재시도를 처리한다. 같은 ID로 다른 파일을 보내면 409다. 업로드 응답이 끊기면 화면에서 선택한 원본 파일로 재시도할 수 있다. 화면을 새로 열어 파일 선택이 사라졌다면 미완료 항목을 삭제하고 새 ID로 다시 업로드한다. 삭제한 ID는 새 업로드에 재사용하지 않는다.

`pdf_imports` 상태는 `UPLOADING → PENDING → PROCESSING → READY → IMPORTED`다. 실패는 `FAILED`로 남고 파싱을 다시 시도할 수 있다. 진행 중인 업로드/파싱은 사용자당 최대 5개다. Worker는 120초 lease와 최대 3회 자동 복구를 사용하며, 이전 lease의 결과 저장을 차단한다. 실제 파일의 길이와 SHA-256을 검증한 뒤 파싱한다.

파서는 별도 프로세스에서 실행한다. 30초 실행 제한, Linux에서 CPU 20초·주소 공간 384MiB·출력 파일 크기 제한을 적용하며 인증 정보를 전달하지 않는다. 네트워크와 자식 프로세스 실행을 차단한다. 파일·본문·서비스 키를 로그에 출력하지 않는다.

처리 중이거나 이미 서재에 등록한 PDF는 가져오기 목록에서 삭제할 수 없다. 나머지는 가져오기 행 제거 후 해당 원본만 Storage API로 삭제한다. 두 시스템의 삭제는 단일 트랜잭션이 아니므로 원본 삭제에 실패하면 동일 ID의 **원본 정리 다시 시도**를 제공한다. 계정 관리나 테스트 정리에서는 Storage API로 해당 계정의 원본을 먼저 제거한 뒤 계정을 삭제한다.

## API

모든 요청은 `Authorization: Bearer <access token>`을 사용한다.

| 경로 | 동작 |
| --- | --- |
| `GET /api/pdf-imports` | 활성화 여부와 최근 20개 가져오기 조회 |
| `POST /api/pdf-imports` | raw PDF 업로드. `Content-Type: application/pdf`, `X-Import-Id: UUID`, `X-File-Name: encodeURIComponent(파일명)` 필수 |
| `GET /api/pdf-imports/{id}` | 본인 작업 상태·검증된 결과 조회 |
| `POST /api/pdf-imports/{id}` | `{action:"confirm",title,currentPage}`로 서재 등록 또는 `{action:"retry"}`로 파싱 재시도 |
| `DELETE /api/pdf-imports/{id}` | 삭제 가능한 본인 작업과 해당 원본 정리 |
| `GET /api/resources/books/{id}/pdf` | 등록된 자료의 PDF 출처·추출 결과 |
| `GET /api/resources/books/{id}/pdf/file` | 인증된 원본 다운로드 |

파일 경로·해시·lease는 웹 응답에서 제외한다. 등록 확인을 같은 제목/현재 페이지로 다시 보내면 기존 자료 ID를 반환하고 다른 정보로 반복하면 409다. 확인 결과의 원래 입력은 이후 학습 진도가 달라져도 유지된다.

## 로컬 실행과 검증

1. `supabase migration up --local`로 PDF migration까지 적용한다.
2. `services/ai-worker/.env`에 `PDF_ENABLED=true`, `SUPABASE_URL=http://host.docker.internal:55321`, 로컬 `SUPABASE_SERVICE_ROLE_KEY`를 설정한다. AI 기능은 별도 `AI_ENABLED` 설정이다.
3. `docker compose --env-file services/ai-worker/.env -f docker/docker-compose.yml up --build -d`로 Worker를 실행한다.
4. `apps/web/.env.local`에 `PDF_ENABLED=true`를 설정한다. 실제 환경 파일은 Git에서 제외한다.

`pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:test`, `pnpm db:types:check`, `pnpm test:ai:worker`로 검증한다. `pnpm test:pdf:integration`은 실제 프로덕션 웹·Auth·Storage·Python 파서를 사용한다. 이 테스트는 직접 Worker를 실행하므로 다른 PDF 소비자를 중지하고 대기열이 빈 로컬 환경에서 실행해야 한다. 테스트가 원본 객체를 Storage API로 정리한 뒤 임시 계정을 삭제한다.

OCR, 중첩 학습단원 편집, 비밀번호 해제, 강의·Habit은 후속 범위다.
