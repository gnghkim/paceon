# 자체 서버 운영 (nuc7)

> 상태: **설계 승인, 이전 전** (2026-10-10). 이전을 마치면 이 문서를 운영 절차서로 고치고 ARCHITECTURE의 배포 부분을 바꾼다.

PaceOn을 Vercel(웹), Supabase Cloud(DB·로그인·파일), Hostinger VPS(Worker)에서 집에 있는 우분투 서버 nuc7 한 대로 옮긴다. 기능은 지금과 같고, nuc7에서 이미 돌고 있는 다른 서비스(특히 실계좌 자동매매 ETFlow)는 계속 안정적으로 돌아야 한다.

## 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 접속 | Cloudflare Tunnel + `nolzza.net` | 누구나 인터넷에서 접속. 공유기 포트를 열지 않고 집 IP를 숨긴다. HTTPS 자동 |
| DB·로그인·파일 | Supabase를 nuc7에 직접 띄움 | 앱 코드를 거의 그대로 둔다. 대신 백업과 업데이트를 직접 맡는다 |
| 인증 메일 | Resend SMTP, `noreply@nolzza.net` | 내 도메인으로 보내 스팸함에 덜 빠진다. 무료 월 3,000통 |
| 백업 | Cloudflare R2, age로 암호화 | Cloudflare 계정을 함께 쓴다. 10GB까지 무료(지금 DB 19MB) |
| 배포 | CI가 이미지를 만들고 nuc7이 당겨 옴 | 무거운 빌드를 Celeron 2코어에서 돌리지 않는다. nuc7로 들어오는 접속이 필요 없다 |

## 서버

| 항목 | 값 |
| --- | --- |
| 접속 | `ssh nuc7` (Tailscale `100.85.106.9`, 사용자 `gnghkim`) |
| OS | Ubuntu 26.04.1 LTS, x86_64 |
| 사양 | Celeron J4005 2코어, RAM 6.8GB, SSD 250GB(여유 200GB) |
| 네트워크 | Wi-Fi(`wlo2`, 공유기 안쪽 `172.30.1.13`). 유선으로 바꾸기를 권한다 |
| 함께 도는 것 | ETFlow(실계좌 매매), ytvault, bolt. 호스트 포트 8000·8787을 이미 쓴다 |
| 없는 것 | Docker, Node, 웹 서버. `sudo`는 비밀번호가 필요해 설치 명령은 사용자가 직접 실행한다 |

PaceOn은 함께 도는 서비스의 설정·포트·파일을 건드리지 않는다.

## 구성

```
인터넷 ─ Cloudflare ─(Tunnel: nuc7이 밖으로 연결)─┐
                                                    ▼
nuc7  /opt/paceon   docker compose 프로젝트 "paceon", 전용 내부망
  cloudflared ─► web   (Next.js standalone, :3000)   paceon.nolzza.net
              └► kong  (Supabase API 관문, :8000)    paceon-api.nolzza.net
  kong ─► auth (GoTrue) · rest (PostgREST) · storage (파일은 로컬 볼륨)
  db (Postgres 17) ◄─ web · ai-worker · auth · rest · storage
  ai-worker (알림·텔레그램·AI·PDF 소비자)
  studio · Postgres ─ Tailscale IP에만 연다 (관리, migration)
```

- API 주소는 `paceon-api.nolzza.net`이다. Cloudflare 무료 인증서는 `*.nolzza.net` 한 단계만 덮어서 `api.paceon.nolzza.net`은 쓸 수 없다.
- 브라우저가 Supabase를 직접 부르므로(`supabase-browser.ts`, 로그인, YouTube 연결) API 주소도 밖에 연다. 웹은 Worker를 내부망 주소(`http://ai-worker:8000`)로 부른다.
- Supabase 공식 self-hosting 구성에서 쓰는 것만 띄운다. Realtime, Edge Functions, 로그 분석(analytics·vector), 이미지 변환(imgproxy), 풀러(supavisor)는 쓰지 않으니 뺀다. Studio와 pg-meta는 관리할 때만 켜는 compose profile로 둔다.
- Kong은 `/auth/v1`, `/rest/v1`, `/storage/v1`만 밖으로 내보낸다. `/pg`(pg-meta)는 막는다.
- Postgres는 Cloud와 같은 17이다(`supabase/config.toml`의 `major_version`). Auth(GoTrue) 버전은 Cloud에서 쓰는 버전보다 낮지 않게 고른다. `auth.users` 열이 버전마다 달라서다.

### 자원 상한

nuc7은 2코어라 PaceOn이 매매 봇의 몫을 빼앗으면 안 된다. nuc7의 Docker는 PaceOn만 쓰므로 Docker 데몬의 `cgroup-parent`를 `paceon.slice`로 두고, 이 slice에 전체 상한을 건다.

| 범위 | 상한 |
| --- | --- |
| `paceon.slice` 전체 | `CPUQuota=150%`, `MemoryHigh=3G`, `MemoryMax=3.5G` |
| db | 메모리 1GB |
| ai-worker | 메모리 768MB (ffmpeg, PDF 처리) |
| web | 메모리 512MB |
| storage, kong | 각 256MB |
| auth, rest | 각 128MB |
| cloudflared | 64MB |

### 바꾸는 코드

앱 로직은 바꾸지 않는다.

- `apps/web/next.config.ts`에 `output: 'standalone'`.
- 웹 이미지용 `apps/web/Dockerfile`(모노레포 빌드).
- 운영용 compose `deploy/nuc7/compose.yaml`과 Kong 설정, `.env.example`. 개발용 `compose.yaml`은 그대로 둔다.
- `.github/workflows/images.yml`: main에 병합되면 web·worker 이미지를 GHCR에 `main`과 커밋 SHA 태그로 올린다. `NEXT_PUBLIC_*`는 빌드할 때 이미지에 박히므로 공개 키와 API 주소를 GitHub 변수(Variables)로 넘긴다. 비밀 값은 넣지 않는다.
- nuc7의 배포 타이머(systemd): 5분마다 `docker compose pull`로 새 `main` 이미지를 확인하고, 바뀌었으면 `up -d`로 교체한 뒤 healthchecks.io에 신호를 보낸다.

### 키

- 새 JWT secret으로 anon·service_role 키를 만든다. Cloud의 키는 옮기지 않는다.
- 앱은 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`와 `SUPABASE_SECRET_KEY`(또는 `SUPABASE_SERVICE_ROLE_KEY`) 값을 헤더에 그대로 넣기만 한다. self-hosted가 새 형식 키(`sb_publishable_…`, `sb_secret_…`)를 받지 않으면 같은 변수에 anon·service_role JWT를 넣는다. 코드 변경은 없다. 이전의 첫 단계에서 확인한다.
- JWT secret이 바뀌므로 기존 로그인 세션은 끊긴다. 비밀번호 해시는 옮기므로 같은 비밀번호로 다시 로그인하면 된다.
- VAPID 키, 텔레그램 토큰, OpenAI·Gemini 키, Google OAuth 값, `YOUTUBE_TOKEN_ENCRYPTION_KEY`는 지금 값을 그대로 옮긴다. 암호화 키가 바뀌면 저장된 YouTube 토큰을 풀 수 없다.

## 이전 절차

### 준비 (운영에 영향 없음)

1. **nuc7**: Docker Engine과 compose 플러그인 설치, `paceon.slice`와 데몬 설정, ufw에서 `tailscale0`으로 들어오는 5432·3001만 허용. 명령은 절차서로 드리고 `sudo`는 사용자가 실행한다.
2. **DNS**: nolzza.net을 Cloudflare(무료)에 등록한다. 지금 네임서버는 후이즈(`ns1~4.whoisdomain.kr`)이고, apex와 `www`가 Vercel의 다른 사이트를 가리킨다. 후이즈 관리 화면에서 레코드를 **전부** 확인해 Cloudflare에 같게 넣는다(공개 조회로는 하위 주소를 다 볼 수 없다). Vercel 레코드는 회색 구름(DNS only)으로 둔다. 대조를 마친 뒤 후이즈에서 네임서버를 바꾼다.
3. **Cloudflare**: Tunnel을 만들고 `paceon.nolzza.net` → `http://web:3000`, `paceon-api.nolzza.net` → `http://kong:8000`을 잇는다. R2 버킷과 쓰기 전용 토큰을 만든다.
4. **Resend**: `nolzza.net`을 인증한다(Cloudflare DNS에 SPF·DKIM 레코드). Auth의 SMTP로 넣는다.
5. **빈 스택**: nuc7에 새 키로 스택을 띄우고, 개발 PC에서 Tailscale로 `supabase db push --db-url postgresql://postgres:…@100.85.106.9:5432/postgres`를 실행한다. `supabase test db --db-url …`로 pgTAP을 nuc7 DB에 돌려 스키마가 같은지 확인한다. 키 형식도 여기서 확인한다.
6. **리허설**: 운영 데이터를 덤프해 nuc7에 복원하고 새 주소에서 로그인해 본다.
   - 옮기는 것: `public`의 데이터, `auth.users`·`auth.identities`, `storage.objects`(지금 0개). `storage.buckets`는 migration이 만드므로 옮기지 않는다.
   - migration이 넣는 기본 행과 겹치는 테이블이 있으면 복원 전에 비운다. 리허설에서 목록을 정해 절차서에 적는다.
   - 테이블마다 행 수를 Cloud와 대조한다. 첫 백업·복원 연습도 이때 한다.

### 전환 (약 30분 중단)

사용자는 1명(본인)이라 공지 없이 하되, 전환하는 동안 기존 앱은 쓰지 않는다.

1. VPS의 `paceon-ai-worker`를 멈춘다. 텔레그램 폴링도 함께 멈춰 두 곳이 같은 봇 토큰을 읽지 않게 한다.
2. 최종 덤프를 받아 nuc7에 복원하고 행 수를 대조한다.
3. nuc7 Worker를 `TELEGRAM_ENABLED=true`로 켠다. 반드시 1번 뒤에만.
4. 주소를 바꾼다.
   - Auth `SITE_URL`과 허용 리디렉트: `https://paceon.nolzza.net`.
   - `APP_URL`: `https://paceon.nolzza.net`.
   - Google Cloud 콘솔의 OAuth 리디렉트 URI에 새 주소를 넣는다.
   - 푸시 구독은 출처(origin)에 묶여 있어 새 주소에서 다시 켜야 한다. 옛 주소의 구독 2개는 지운다.
5. Vercel 프로젝트의 Git 연결을 끊고, `paceon-green.vercel.app`이 `paceon.nolzza.net`으로 넘어가는 리디렉트만 배포한다. nolzza.net의 다른 Vercel 사이트는 건드리지 않는다.
6. 확인: 로그인, 가입 확인 메일, 독서 기록, PDF 올리기, 음성 재생(Storage), 푸시 테스트, 텔레그램 답장, AI 작업, 다음 날 아침 매일 알림.

### 되돌리기

전환 뒤 2주 동안 Supabase Cloud, Vercel 프로젝트, VPS의 PaceOn은 멈춘 채 남긴다. 문제가 생기면 nuc7 Worker를 멈추고, VPS Worker를 켜고, Vercel 리디렉트를 빼고 Git 연결을 되살린다. 전환 뒤 nuc7에 쌓인 기록은 nuc7에서 덤프해 Cloud에 복원해야 한다.

### 정리 (2주 뒤)

- Supabase Cloud의 `paceon` 프로젝트를 지운다. 무료 칸이 하나 비어 KTGO를 다시 켤 수 있다.
- Vercel의 `paceon` 프로젝트는 옛 주소 리디렉트를 3개월 더 둔 뒤 지운다.
- VPS는 linkvault와 함께 쓰므로 서버는 남기고 `paceon-ai-worker` 컨테이너·이미지와 `/opt/paceon`, `/opt/paceon-deploy`만 지운다.

## 운영

### 백업

- 매일 07:00 KST. 미국장 마감(05:00~06:00)과 국내장 개장(09:00) 사이라 ETFlow가 거래하는 때를 피한다. `nice`·`ionice`로 낮은 우선순위로 돈다.
- DB 전체(`auth`·`storage` 포함)의 `pg_dump -Fc`와 Storage 볼륨 tar를 age 공개키로 암호화해 R2에 올린다. 백업에는 비밀번호 해시와 토큰이 들어 있다. 복호화 키는 서버에 두지 않고 사용자의 비밀번호 관리자에 둔다.
- R2 수명 주기 규칙: 일간 14개, 월간(매월 1일) 6개.
- 매달 최신 백업을 임시 Postgres 컨테이너에 복원해 행 수를 세는 스크립트를 돌린다.
- 백업이 끝나면 healthchecks.io에 신호를 보낸다. 신호가 끊기면 메일이 온다.

### 감시

- UptimeRobot(무료, 5분 간격): `https://paceon.nolzza.net`과 `https://paceon-api.nolzza.net/auth/v1/health`.
- healthchecks.io(무료): 백업과 배포 타이머.
- 알림은 gnghkim@gmail.com으로 받는다.
- Docker 로그는 컨테이너마다 10MB × 3개로 돌려 쓰고, 쓰지 않는 이미지는 매주 지운다.

### 업데이트

- Supabase 이미지는 공식 compose의 버전으로 고정한다. 분기마다 버전을 올려 로컬에서 migration과 pgTAP을 돌려 본 뒤 바꾼다.
- OS 보안 패치는 이미 켜진 `unattended-upgrades`에 맡긴다. 재부팅하면 컨테이너는 `restart: unless-stopped`로 다시 뜬다.
- migration은 지금처럼 앱보다 먼저 올린다. 순서는 `supabase db push --db-url …`(Tailscale) → PR 병합 → 배포 타이머가 새 이미지를 당겨 옴.

### 보안

- 공유기 포트는 열지 않는다. 밖에서 들어오는 길은 Tunnel 하나다.
- Studio와 Postgres는 Tailscale IP에만 연다.
- 비밀 값은 nuc7의 `/opt/paceon/.env` 한 곳에 두고 권한은 600이다. Git에 넣지 않는다.
- GitHub에는 공개 빌드 값만 둔다. GHCR 이미지가 비공개면 nuc7에는 `read:packages` 권한만 있는 토큰 하나를 둔다.

### 사용자가 직접 할 일 (권장)

- nuc7을 유선 LAN으로 연결한다.
- BIOS에서 정전 뒤 전원이 돌아오면 저절로 켜지게 한다(AC power loss → Power On).
