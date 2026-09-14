# YouTube 계정 연결 설정 (LR2)

현재 Google Cloud 프로젝트와 OAuth 자격 증명이 없어 실제 계정 동의는 검증하지 않았습니다. 설정 전에는 연결 UI에 준비 중 안내가 표시되며, 링크 저장·공식 플레이어·수동 자막·노트 학습은 별도로 사용할 수 있습니다.

## Google 프로젝트 만들기

1. [Google Cloud Console](https://console.cloud.google.com/)에서 프로젝트를 만듭니다. API 및 서비스 → 라이브러리에서 **YouTube Data API v3**를 사용 설정합니다.
2. Google Auth Platform에서 앱 브랜딩, 지원 이메일, 대상 사용자 및 개발자 연락처를 입력합니다. 외부 사용자를 대상으로 개발할 때는 테스트 모드로 시작하고 사용할 Google 계정을 테스트 사용자로 등록합니다.
3. 데이터 액세스에 **`https://www.googleapis.com/auth/youtube.readonly`** 범위만 추가합니다. 쓰기·업로드·구독 변경 권한은 필요하지 않습니다.
4. 클라이언트에서 **웹 애플리케이션** OAuth 클라이언트를 만듭니다. 승인된 리디렉션 URI를 다음 형식으로 정확하게 등록합니다.

   - 로컬: `http://localhost:3000/api/youtube/callback` (실제 개발 포트가 다르면 포트를 맞춥니다.)
   - 배포: `https://YOUR_DOMAIN/api/youtube/callback`

5. 아래 환경 변수를 **`apps/web/.env.local`** 또는 배포 비밀 설정에 넣고 웹 서버를 재시작합니다. 클라이언트 보안 비밀과 암호화 키, service-role 키에는 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다.

```dotenv
GOOGLE_CLIENT_ID=<Google 웹 OAuth 클라이언트 ID>
GOOGLE_CLIENT_SECRET=<Google 웹 OAuth 클라이언트 보안 비밀>
YOUTUBE_TOKEN_ENCRYPTION_KEY=<암호학적으로 무작위 생성한 32바이트의 표준 base64>
APP_URL=http://localhost:3000
SUPABASE_SERVICE_ROLE_KEY=<동일 Supabase 프로젝트의 서버 service_role 키>
# 기존 애플리케이션 설정
NEXT_PUBLIC_SUPABASE_URL=<Supabase URL>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<공개 publishable 키>
```

`APP_URL`은 경로·쿼리 없는 고정 origin입니다. HTTPS를 사용하며 HTTP는 localhost 또는 127.0.0.1 개발 환경에서만 허용합니다. 브라우저로 접속한 origin도 일치해야 callback 브라우저 쿠키가 전달됩니다. 암호화 키는 비밀 관리자에 저장하고 백업합니다. 키 교체 전에 연결을 해제하고 새 키 배포 후 다시 연결해야 합니다. 비밀 값을 채팅, 로그, 이슈 또는 Git에 올리지 않습니다.

암호화 키는 로컬 터미널에서 아래 명령으로 한 번 생성해 `YOUTUBE_TOKEN_ENCRYPTION_KEY`에 넣습니다. 출력값은 채팅에 보내지 않습니다.

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

## 데이터베이스와 토큰 수명

`20260921000000_youtube_connections.sql`을 먼저 적용합니다. 토큰 및 PKCE verifier는 AES-256-GCM으로 암호화되며 사용자 ID를 추가 인증 데이터로 사용합니다. `private.youtube_connections`는 외부 데이터 API에 노출되지 않습니다. 공개 RPC의 실행 권한은 `service_role`에만 부여됩니다. 사용자 Bearer 토큰은 서버에서 Supabase 인증 확인에만 사용합니다.

OAuth state는 10분 유효하고 서버에서 해시로 저장됩니다. HttpOnly, SameSite=Lax 브라우저 쿠키의 별도 비밀과 함께 일회성으로 소비합니다. 토큰 갱신은 기존 ciphertext와 연결 generation을 비교해 적용합니다. 연결 해제 또는 새 연결 후 오래된 갱신/콜백은 연결을 복원할 수 없습니다.

연결 해제는 로컬 인증 정보를 먼저 삭제하고 Google 철회를 시도합니다. Google 철회가 실패해도 로컬 토큰은 삭제되며 UI에서 [Google 계정의 연결된 앱](https://myaccount.google.com/connections)에서 권한을 삭제하도록 안내합니다. Google 프로젝트 내 다른 OAuth 클라이언트의 승인에도 철회가 영향을 줄 수 있습니다. 사용자 계정 삭제 시 토큰 행도 함께 삭제됩니다.

목록 제목과 채널 아이콘 등 API 응답은 `no-store`로 현재 화면에만 표시하고 DB, 브라우저 저장소, AI 입력에 저장하지 않습니다. 연결 해제 시 화면 목록도 지웁니다. 사용자가 명시적으로 선택한 canonical 영상 URL만 일반 링크 저장 API에 전달하며 API 제목을 자료 제목에 복사하지 않습니다. 사용자가 작성한 제목·노트·학습 기록은 연결 해제 후에도 유지됩니다.

## 확인 절차

1. 테스트 사용자로 PaceOn 로그인 후 YouTube 연결을 누릅니다. Google 동의 화면에서 읽기 권한만 확인하고 승인합니다.
2. 고정 callback으로 돌아온 뒤 채널 이름·아이콘을 확인합니다. 재생목록 및 구독 채널을 조회하고 다음 페이지, 채널 업로드 목록, 최대 20개 선택 저장을 확인합니다.
3. 동의 취소, 채널 없는 계정, 만료/철회, quota 초과, 연결 해제 후 재연결을 확인합니다. 기존 학습 자료는 계속 사용할 수 있어야 합니다.
4. Google 계정에서 권한을 철회한 뒤 재연결 안내를 확인합니다. 테스트 모드의 외부 앱에서 이 scope로 발급된 refresh token은 일반적으로 7일 후 만료됩니다. 테스트 모드를 벗어나 공개 운영하기 전에 Google의 OAuth 검증 및 개인정보처리방침·YouTube API 정책 요구사항을 확인합니다.

로컬 제공자 fixture: `node --test tests/youtube-oauth.test.mjs`. 실제 Google 동의, 실제 계정 데이터, 배포 callback과 실제 만료·철회는 자격 증명을 등록한 후 위 절차로 별도 검증해야 합니다. OAuth 연결과 임베드 플레이어의 로그인 상태는 별개이며 Premium, 광고 제거, YouTube 전체 시청 기록, 나중에 볼 동영상 동기화를 제공하지 않습니다.

## API 계약

사용자 요청은 Supabase `Authorization: Bearer ...`를 사용합니다(callback 제외).

| 요청 | 응답 |
| --- | --- |
| GET `/api/youtube/status` | `{configured,connected,channel?:{id,title,thumbnail},error?}` |
| POST `/api/youtube/connect` | `{url}` 및 HttpOnly callback 쿠키 |
| GET `/api/youtube/callback` | 고정 `/learn?youtube=connected\|denied\|failed`로 303 |
| POST `/api/youtube/disconnect` | `{disconnected:true,revoked:boolean}` |
| GET `/api/youtube/library?kind=playlists\|subscriptions` | `{items:[{id,title,kind}],nextPageToken?}` |
| GET `/api/youtube/library?kind=videos&playlistId=...` 또는 `&channelId=...` | 동일한 페이지 응답, 항목 kind는 `video` |

페이지 토큰은 `pageToken` 쿼리 매개변수로 전달합니다. 선택 저장은 POST `/api/learning/videos`에 `{requestId,items:[{url}]}`를 최대 20개 전달합니다.

공식 근거: [웹 서버 OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth 정책](https://developers.google.com/identity/protocols/oauth2/policies), [토큰 만료 및 테스트 모드](https://developers.google.com/identity/protocols/oauth2), [재생목록 항목 API](https://developers.google.com/youtube/v3/docs/playlistItems/list), [구독 목록](https://developers.google.com/youtube/v3/docs/subscriptions/list), [채널 업로드 목록](https://developers.google.com/youtube/v3/docs/channels), [개발자 정책](https://developers.google.com/youtube/terms/developer-policies).
