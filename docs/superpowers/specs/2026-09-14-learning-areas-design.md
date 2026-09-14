# 학습실 영역 분리 설계 (리스닝 · 스피킹 · 라이팅)

작성일: 2026-09-14 · 기준 커밋: `1f8b9f8` (PR #2 병합)

## 1. 목적과 범위

학습실 홈(`/learn`)에 이어서 공부하기, YouTube 링크 저장, YouTube 계정 연결, 쓰기·스피킹 시작, 저장한 학습실, 최근 기록이 한 화면에 쌓여 있다. 공간을 열면 영역과 무관하게 글쓰기와 말하기 패널이 함께 나온다. 이를 영역별로 나눈다.

**포함**

- 학습실을 리스닝(YouTube), 스피킹, 라이팅 세 영역 탭으로 나눈다.
- 공간마다 영역을 저장하고, 공간 화면은 그 영역 기능만 보여 준다.
- YouTube 계정 연결 관리를 새 설정 페이지로 옮긴다.

**제외**

- RC(리딩). 나중에 네 번째 탭으로 추가할 수 있게 구조만 열어 둔다.
- 주 메뉴·모바일 하단 메뉴 변경.
- 세션·영상·음성 명령의 요청 형식 변경.

## 2. 현재 구조 (확인한 사실)

- `learning_workspaces`에 종류 컬럼이 없다. 글(`learning_messages`), 음성(`learning_speech`), 영상(`learning_videos`)이 모두 공간 ID에 연결된다.
- "스피킹 시작"은 제목이 `나의 영어 말하기`인 일반 공간을 만들고 `#learning-speech`로 스크롤한다.
- `/learn/[id]`와 `/learn/items/[id]`는 같은 `LearningRoom` 컴포넌트를 쓴다. 영상 공간에서도 글 입력(`MESSAGE`·`SUMMARY`·`SAVE_DRAFT`)과 말하기 패널(쉐도잉)이 동작한다.
- 공간은 `learning_command`의 `CREATE`(제목·프롬프트)와 `learning_video_command`의 `VIDEO_ADD`(제목)에서만 만들어진다.
- 사용자는 공간 테이블에 `SELECT` 권한만 있고, 쓰기는 모두 security definer 함수를 거친다.
- 목록 API는 종류 구분 없이 최근 수정 순으로 100개씩 가져오고 `offset` 외의 파라미터는 400으로 거부한다.
- 명령 오류 매핑이 `learning-api.ts`, `learning-videos-api.ts`, `speech-api.ts` 세 곳에 따로 있다.

## 3. 화면과 주소

### 3.1 영역 화면

route group `app/(workspace)/learn/(areas)`에 공통 레이아웃을 둔다.

```
학습실
[이어서 공부하기: 전체 영역에서 최근 3개, 영역 배지]
[ 리스닝 | 스피킹 | 라이팅 ]   ← 링크형 탭 (aria-current)
─────────────────────────────
탭 내용
```

| 주소 | 내용 |
| --- | --- |
| `/learn` | 기기에 저장한 마지막 탭으로 이동. 값이 없거나 잘못되면 `/learn/listening` |
| `/learn/listening` | 영상 링크 저장, **YouTube에서 가져오기**(미연결 시 설정 링크, 서버 설정이 없으면 숨김), 영상 목록, 리스닝 공간 최근 기록 |
| `/learn/speaking` | **새 스피킹 시작**, 스피킹 공간 목록, 최근 기록, AI 사용 불가 안내 |
| `/learn/writing` | **새 글 쓰기**, 라이팅 공간 목록, 최근 기록, AI 사용 불가 안내 |

- 탭 선택은 `localStorage`에 기기별 편의 값으로만 저장한다. 읽기·쓰기가 실패해도 기본 탭으로 동작한다.
- 주 메뉴의 "학습실"은 `/learn/*` 전체에서 활성으로 표시한다(현재 동작 유지).

### 3.2 공간 화면

기존 주소를 유지한다.

| 주소 | 종류 | 표시 기능 |
| --- | --- | --- |
| `/learn/items/[id]` | 리스닝 | 타이머, 영상, 메모, 자막, 질문, 쉐도잉 (현재와 동일) |
| `/learn/[id]` | 스피킹 | 타이머, 말하기 패널 |
| `/learn/[id]` | 라이팅 | 타이머, 글쓰기, AI 첨삭, 정리. 기존 음성 기록이 있으면 접힌 **이전 말하기 기록**(읽기 전용: 인식문·피드백 보기와 녹음 재생, `DELETE`·`DELETE_AUDIO`·`KEEP`만 가능. 재생은 `SPEECH_TICK`을 보내지 않으며 학습 시간에 넣지 않는다) |

- 리스닝 공간을 `/learn/[id]`로 열면 `/learn/items/[id]`로 이동한다.
- 공간 화면의 뒤로 가기 링크는 해당 영역 탭으로 연결한다.
- 표시 기능은 순수 함수 `learningRoomFeatures(kind)`로 결정한다. 종류만 받으며, 이전 말하기 기록(`LegacySpeechRecords`)은 스스로 불러오고 기록이 없으면 아무것도 렌더링하지 않는다.
- 이전 말하기 기록 목록은 `RECORDING` 항목만 보여준다. AI 예시 음성(`PROMPT`)은 보관 기한 정리에 맡긴다.
- 스피킹 공간의 타이머 시작 안내 문구는 `녹음하거나 음성을 들으면 시작돼요`다.

### 3.3 설정

- 새 페이지 `/settings`에 "연결된 계정 · YouTube"를 둔다: 연결, 다시 연결, 연결 해제, 권한 안내, Google 권한 관리 링크.
- 입구는 헤더의 로그아웃 옆 톱니 아이콘(데스크톱·모바일 공통).
- OAuth 완료 후 `/settings?youtube=connected|denied|failed`로 돌아오고 결과를 설정 화면에 표시한다.
- `youtube-account.tsx`를 `youtube-connection.tsx`(설정)와 `youtube-import.tsx`(리스닝 탭)로 나눈다. 목록 병합은 기존 `youtube-library.ts`를 계속 쓴다.

## 4. 데이터

새 migration `supabase/migrations/20261001000000_learning_workspace_kind.sql`.

### 4.1 컬럼

- `learning_workspaces.kind text`, 값은 `LISTENING`·`SPEAKING`·`WRITING`.
- 기본값을 두지 않는다. 종류를 빠뜨린 insert는 실패해야 한다.
- 인덱스 `(user_id, kind, updated_at desc, id desc)`.

### 4.2 기존 공간 분류

위에서부터 먼저 맞는 규칙을 적용한 뒤 `not null`과 `check` 제약을 건다.

| 순서 | 조건 | 결과 |
| --- | --- | --- |
| 1 | `learning_videos` 행 있음 | `LISTENING` |
| 2 | `learning_messages` 행 있음 또는 `draft <> ''` | `WRITING` (음성 기록이 섞여 있어도) |
| 3 | `learning_speech` 행 있음 | `SPEAKING` |
| 4 | 기록 없음, 제목 `나의 영어 말하기` | `SPEAKING` |
| 5 | 그 외 | `WRITING` |

### 4.3 생성과 불변성

- `CREATE` 명령 키에 `kind`를 추가하고 `SPEAKING`·`WRITING`만 허용한다.
- `VIDEO_ADD`는 `LISTENING`으로 만든다.
- 종류를 바꾸는 경로를 만들지 않는다.

### 4.4 영역별 명령 허용 (DB 함수에서 강제)

| 명령 | 리스닝 | 스피킹 | 라이팅 |
| --- | --- | --- | --- |
| `START`·`TAKEOVER`·`HEARTBEAT`·`PAUSE`·`END` | ✓ | ✓ | ✓ |
| `VIDEO_*` | ✓ | ✗ | ✗ |
| 글 명령 `SAVE_DRAFT`·`MESSAGE`·`SUMMARY`·`RETRY`(글 AI 작업) | ✓ | ✗ | ✓ |
| 음성 생성·변경 `PROMPT`·녹음 업로드(`begin_speech_upload`)·`EDIT`·`RETRY`(음성 작업)·`SPEECH_TICK` | ✓ | ✓ | ✗ |
| 음성 개인정보 관리 `DELETE`·`DELETE_AUDIO`·`KEEP` | ✓ | ✓ | ✓ |

허용되지 않은 명령은 `LEARNING_KIND` 예외로 거부한다. RLS와 소유 관계는 바꾸지 않는다. 적용 후 `pnpm db:types`로 타입을 생성한다.

## 5. API

### 5.1 `GET /api/learning/workspaces`

- 허용 파라미터: `kind`(`LISTENING`·`SPEAKING`·`WRITING`), `offset`. 각각 최대 한 번. 그 외는 400.
- `kind`가 있으면 해당 영역 공간만 100개씩 반환한다. 세션도 `learning_workspaces!inner(kind)` embed로 같은 영역만 남긴다. 리스닝이면 영상 정보를 함께 반환한다.
- `kind`가 없으면 전체 영역을 반환한다. "이어서 공부하기"가 첫 페이지의 3개를 쓴다.
- 응답 형식은 유지하고 각 공간에 `kind`를 추가한다.

### 5.2 `POST /api/learning/workspaces`

- 본문 `kind` 필수(`SPEAKING`·`WRITING`). 없으면 400.
- 스피킹 탭은 `kind: SPEAKING`으로 만든 뒤 `/learn/[id]`로 이동한다. `#learning-speech` 앵커는 제거한다.

### 5.3 기타

- `GET /api/learning/workspaces/[id]`는 `workspace.kind`를 포함한다.
- 라이팅 공간의 기존 음성은 `GET /api/learning/speech?workspaceId=`로 불러온다.
- 세 오류 매핑에 `LEARNING_KIND: [409, '이 영역에서는 사용할 수 없는 기능이에요.']`를 추가한다.
- YouTube API는 바꾸지 않고 OAuth 완료 후 이동 주소만 `/settings`로 바꾼다.

## 6. 테스트

| 계층 | 검증 |
| --- | --- |
| pgTAP | 분류 규칙 5가지(섞인 공간, 제목만 있는 스피킹 공간 포함), `not null`·`check`, `kind` 없는 `CREATE` 거부, `VIDEO_ADD` → `LISTENING`, 4.4 허용표 전체, 명령 실행 후 종류 불변 |
| Node 단위 | 목록 `kind` 검증(잘못된 값·중복·모르는 파라미터 400), `POST` `kind` 누락 400, 세 API의 `LEARNING_KIND` → 409, OAuth 완료 후 `/settings` 이동 |
| 순수 함수 | 탭 결정(저장값 없음·잘못됨 → 리스닝), `learningRoomFeatures` 종류별 표시 기능 |
| 통합 | `learning-integration`·`speech-integration`에 `kind` 전달, 영역별 목록, 영역 밖 명령 409 |
| 브라우저 수동 | 390px에서 탭 전환, 종류별 공간 화면, 섞인 기존 공간의 읽기 전용 기록, 설정에서 연결·해제 후 리스닝 탭 가져오기 |

## 7. 구현 순서와 배포

`feat/learning-areas` 브랜치에서 단계별로 커밋한다.

1. DB: migration, pgTAP, DB 타입
2. API: 목록 필터, 생성 `kind`, 오류 매핑, 단위 테스트
3. 학습실 화면: 영역 레이아웃·탭, 종류별 공간 화면, 이전 말하기 기록
4. 설정과 YouTube: `/settings`, 컴포넌트 분리, OAuth 이동 주소
5. 문서: `LEARNING_ROOM.md`, `YOUTUBE_SETUP.md`, `ARCHITECTURE.md`

- migration 적용 후에는 `kind` 없는 `CREATE`가 실패하므로 DB와 웹을 함께 배포한다. 개인용 로컬 환경이라 전환용 호환 코드는 두지 않는다.
- 적용 전 백업: `supabase db dump --local --data-only`.
- 되돌리기: `kind` 컬럼 제거 migration과 이전 웹 코드. 기록 데이터는 삭제하지 않으므로 손실이 없다.
