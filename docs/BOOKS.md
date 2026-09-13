# Book Resource — Phase 3

`@paceon/books`는 웹·DB와 독립적인 도서 입력 검증과 검색 어댑터다. Zod 4.6.2로 등록 입력을 검증하고 ISBN 체크섬·페이지 관계·출처 조건을 검사한다. 수동 등록과 Google Books를 지원하며 `YES24Provider`는 명시적으로 `unsupported`를 반환한다. YES24 실제 연동과 화면은 구현하지 않았다.

## 검색

`GET /api/books/search?q=검색어&provider=google-books&startIndex=0&maxResults=10`

- 공개 메타데이터 검색이며 로그인은 필요 없다. `q`는 공백 제외 1~200자, `startIndex`는 0~1000, `maxResults`는 1~40이다. 제목·저자·Google 검색 구문을 받으며 유효한 ISBN만 입력하면 `isbn:` 검색으로 바꾼다.
- 성공: HTTP 200 `{ status: "ok", books: BookMetadata[], totalItems, manualEntryAvailable: true }`. 검색 결과가 없어도 성공이다.
- Google 오류·쿼터 초과·5초 타임아웃·잘못된 응답: HTTP 503 `{ status: "unavailable", books: [], manualEntryAvailable: true }`.
- `provider=yes24` 또는 `manual`: HTTP 501, `status: "unsupported"`. 수동 입력은 검색 서비스가 필요 없으며 등록 API를 바로 호출한다. 잘못된 파라미터는 400이다.
- Google API 키는 선택적인 서버 환경변수 `GOOGLE_BOOKS_API_KEY`다. 키 없이 검색이 제한될 수 있다. 키·원본 upstream 오류는 응답에 포함하지 않는다. 공개 검색 endpoint의 배포 환경별 요청 제한/쿼터 설정은 운영 시 별도 적용한다.

공통 메타데이터: `title`, `authors`, 선택적인 `isbn`, `publisher`, `pageCount`, `thumbnail`, `description`, `publishedDate`, `tableOfContents`, 출처 `source`/`sourceId`. 누락된 페이지 수를 추측하지 않으며 잘못된 개별 도서는 제외한다. 설명은 외부 문자열이므로 UI에서 일반 텍스트로 표시해야 한다. HTML로 직접 삽입하지 않는다.

## 등록·조회

`POST /api/resources/books` — `Authorization: Bearer <Supabase access token>`, `Content-Type: application/json`

```json
{
  "title": "읽을 책",
  "authors": ["저자"],
  "publisher": "출판사",
  "isbn": "9780306406157",
  "totalPages": 320,
  "currentPage": 80,
  "source": "MANUAL"
}
```

`title`과 `totalPages`는 필수다. 기본값은 `authors: []`, `currentPage: 0`, `source: "MANUAL"`이다. ISBN은 선택이며 공백·하이픈 제거 후 ISBN-10/13 체크섬을 검증한다. `totalPages`는 1~10,000,000 정수, `currentPage`는 0~전체 페이지 정수다. 현재 페이지는 마지막으로 완료한 페이지이며 첫 배정은 그 다음 페이지다. `coverUrl`은 선택적인 HTTPS URL이다.

Google 검색 결과를 선택하면 `pageCount → totalPages`, `thumbnail → coverUrl`로 옮기고 사용자가 페이지 수·ISBN 등을 보정한 후 등록한다. `source: "GOOGLE_BOOKS"`에는 `sourceId`(Google volume ID)가 필수다. 출처는 참고 메타데이터이며 서버가 원본과의 일치 여부를 보증하지 않는다. 외부 검색을 다시 호출하지 않으므로 검색 장애 중에도 저장할 수 있다.

성공은 HTTP 201 `{ resource: <resources 행> }`. `currentPage`는 `initial_completed_workload`에 저장하고 전체 페이지와 같으면 상태는 `COMPLETED`다. 현재 API는 신규 등록용이며 이후 진도 변경은 Phase 5 이력 처리로 구현한다. 등록 요청의 `user_id` 등 계약 외 필드는 저장에 사용하지 않는다.

`GET /api/resources/books?limit=20&offset=0`은 같은 인증이 필요하며 본인 소유 BOOK만 생성 시각 역순으로 반환한다: `{ resources, limit, offset }`. `limit`은 1~100, `offset`은 0~1,000,000이다.

Supabase Auth의 `/auth/v1/user`로 토큰을 검증한 뒤 실제 사용자 ID를 지정한다. DB 요청은 publishable key와 같은 사용자 토큰을 사용하여 RLS를 유지한다. 서비스 비밀 키는 사용하지 않는다. Next가 읽는 `apps/web/.env.local`에 URL/publishable key를 설정한다. 인증 실패 401, 입력 오류 400, 16KiB 초과 413, JSON 외 형식 415, 서비스 미설정·장애 503이며 응답은 캐시하지 않는다. 저장 요청을 자동 재시도하지 않는다. 응답 유실 후 사용자 재등록은 중복 자료를 만들 수 있다.

Phase 2 `scheduleBook`에는 저장된 `total_pages`와 `initial_completed_workload`를 각각 `totalPages`, `completedThroughPage`로 전달한다. Phase 4에서 인증 화면, Today, 자료 목록·상세·등록, Calendar와 첫 계획 미리보기/저장을 연결했다. 계약과 사용 방법은 [WORKSPACE_UI.md](WORKSPACE_UI.md)를 따른다.

## 검증

`pnpm test`는 네트워크 없는 도서/검색/API 테스트와 기존 Scheduler 테스트를 실행한다. `pnpm build` 후 `pnpm test:books:integration`은 실행 중인 Supabase Local에 임시 Auth 사용자 두 명을 만들고, 임의 포트의 프로덕션 Next 서버를 띄워 HTTP 등록·조회·보정·사용자 격리를 검증한다. 계정과 서버는 종료 시 정리하고 키는 메모리에만 유지한다.

구현 근거: [Google Books volumes.list](https://developers.google.com/books/docs/v1/reference/volumes/list), [Google Books 검색 구문](https://developers.google.com/books/docs/v1/using), [Supabase 서버 사용자 검증](https://supabase.com/docs/reference/javascript/auth-getuser).
