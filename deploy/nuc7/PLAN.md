# nuc7 이전 실행 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PaceOn의 웹(Vercel), DB·로그인·파일(Supabase Cloud), Worker(Hostinger VPS)를 집의 우분투 서버 nuc7 한 대로 옮긴다. 기능은 그대로 두고, nuc7에서 이미 도는 ETFlow·ytvault·bolt를 방해하지 않는다.

**Architecture:** nuc7에 docker compose 프로젝트 `paceon` 하나를 띄운다. 구성은 Supabase 공식 self-hosting의 필요한 부분(Postgres, GoTrue, PostgREST, Storage, Envoy), Next.js standalone 웹, 기존 Worker, cloudflared다. 밖에서 들어오는 길은 Cloudflare Tunnel 하나뿐이다. 이미지는 GitHub Actions가 GHCR에 올리고, nuc7의 systemd 타이머가 당겨 온다. 데이터는 Supabase CLI 덤프로 옮기고 행 수와 내용 해시로 대조한다.

**Tech Stack:** Docker Engine + compose v2, supabase/postgres 17.6.1.136, supabase/gotrue v2.196.0, postgrest v14.17, supabase/storage-api v1.74.0, envoyproxy/envoy v1.39.1, cloudflare/cloudflared 2026.10.0, Node 24.14.0, pnpm 9.15.0, Supabase CLI 2.116.0, age, rclone, Cloudflare R2, Resend, healthchecks.io, UptimeRobot.

**Spec:** [`docs/SELF_HOSTING.md`](../../docs/SELF_HOSTING.md)

## Global Constraints

- 도메인: 웹 `https://paceon.nolzza.net`, API `https://paceon-api.nolzza.net`. `api.paceon.nolzza.net`처럼 두 단계 하위 주소는 쓰지 않는다(무료 인증서가 덮지 않는다).
- Supabase 공식 파일은 `supabase/supabase` 커밋 `ff80bb14991e68667c04f74248b954e8babe6fde`의 `docker/`에서 복사한다. 이미지 버전은 위 Tech Stack 그대로 고정한다.
- 키는 기존 형식(HS256 JWT) anon·service_role만 쓴다. `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = anon JWT, `SUPABASE_SERVICE_ROLE_KEY` = service_role JWT.
- `YOUTUBE_TOKEN_ENCRYPTION_KEY`, VAPID 키, 텔레그램 토큰, OpenAI·Gemini 키, Google OAuth 값은 운영 값을 그대로 옮긴다.
- 자원: `paceon.slice` 전체 `CPUQuota=150%`, `MemoryHigh=3G`, `MemoryMax=3584M`. 컨테이너 메모리 db 1g, ai-worker 768m, web 512m, storage·api-gw 256m, auth·rest 128m, cloudflared 128m.
- 호스트에 여는 포트는 127.0.0.1에만 묶는다(db 5432, studio 3001). 공유기 포트와 ufw는 건드리지 않는다.
- 비밀 값은 nuc7의 `/opt/paceon/.env`(600)에만 둔다. 저장소는 `/opt/paceon/src`, 데이터는 `/opt/paceon/data`.
- 텔레그램 봇 토큰은 한 곳에서만 읽는다. nuc7 Worker는 VPS Worker를 멈춘 뒤에만 켠다. 그 전까지 `PACEON_WORKER=off`, `TELEGRAM_ENABLED=false`.
- 백업: 매일 07:00 KST, age로 암호화, R2 `paceon-backup`의 `daily/`(14일)와 `monthly/`(6개월).
- 문서와 UI 글은 한국어, 코드 식별자는 영어. 커밋은 Conventional Commits. main에 직접 커밋하지 않는다. push·PR·병합·배포·외부 대시보드 작업은 사용자에게 먼저 묻는다.
- 셸 스크립트와 `deploy/nuc7/` 아래 파일은 LF 줄 끝으로 저장한다(Windows에서 컨테이너에 올릴 때 CRLF면 깨진다).

## Review Focus

1. **리허설 중 중복 발송**: nuc7에 운영 데이터를 넣어 둔 채 Cloud도 살아 있는 동안 nuc7 Worker가 돌면 같은 푸시 알림·텔레그램 답장·AI 작업이 두 번 나간다. 기본값으로 Worker가 꺼져 있어야 한다. → Task 1(기본값 테스트), Task 3(profile 확인).
2. **빈 apikey나 anon 키로 관리자 경로 접근**: Envoy 설정의 `exact: ''` 비교 때문에 빈 `apikey` 헤더가 service 키처럼 통과할 수 있다. `/rest/v1/`(OpenAPI)와 `/pg/`는 거절되어야 한다. → Task 1(쓰지 않는 비대칭 키 자리에 임의 값), Task 3(smoke).
3. **두 번 복원하기**: 리허설 데이터가 있는 DB에 다시 복원하면 키 충돌로 실패하거나, 반쯤 들어간 채 남으면 안 된다. 이미 행이 있으면 `--reset` 없이는 멈추고, 복원은 한 트랜잭션이어야 한다. → Task 6.
4. **값이 조용히 망가지는 경우**: `$`나 따옴표가 든 비밀 값이 compose 보간으로 바뀌는 것, 행 수 파일을 하나도 못 읽었는데 "차이 없음"으로 통과하는 것. → Task 1, Task 2.
5. **복원 중 트리거의 부작용**: 읽기 상태 트리거 같은 것이 옮기는 행을 고치면 행 수는 같아도 내용이 달라진다. 트리거를 끄고 복원하고, 내용 해시로 대조한다. → Task 2(해시), Task 6(로컬 리허설).

---

## 파일 구조

| 파일 | 책임 |
| --- | --- |
| `deploy/nuc7/PLAN.md` | 이 계획 |
| `deploy/nuc7/compose.yaml` | 운영 스택 정의(서비스, 포트, 메모리, profile) |
| `deploy/nuc7/compose.local.yaml` | 개발 PC에서 같은 스택을 띄워 보는 덮어쓰기 |
| `deploy/nuc7/.env.example` | 키 목록과 설명. 값은 `init-env.mjs`가 만든다 |
| `deploy/nuc7/supabase/` | 공식 파일 복사본(Envoy 4개, DB 초기화 SQL 3개)과 출처 `SOURCE.md` |
| `deploy/nuc7/bin/init-env.mjs` | env 파일을 한 번 만든다(새 비밀 값 + 운영 값 가져오기) |
| `deploy/nuc7/bin/compose` | nuc7용 `docker compose` 감싸개(env 파일, profile) |
| `deploy/nuc7/bin/node` | nuc7에 Node가 없어 컨테이너로 Node 스크립트를 돌리는 감싸개 |
| `deploy/nuc7/bin/deploy.sh` | 타이머가 부르는 이미지 갱신 |
| `deploy/nuc7/bin/backup.sh` | 타이머가 부르는 암호화 백업 |
| `deploy/nuc7/bin/restore-check.sh` | 개발 PC에서 도는 월간 복원 연습 |
| `deploy/nuc7/host/` | root 설정: `install-host.sh`, `paceon.slice`, `daemon.json`, systemd unit 4개 |
| `deploy/nuc7/migrate/counts.sql` | 테이블마다 "이름,행 수,내용 해시" |
| `deploy/nuc7/migrate/verify-counts.mjs` | 두 행 수 파일 비교 |
| `deploy/nuc7/migrate/dump.sh` | 원본 Supabase에서 데이터 덤프 |
| `deploy/nuc7/migrate/restore.sh`, `reset.sql` | 대상 DB에 한 트랜잭션으로 복원 |
| `deploy/nuc7/migrate/copy-storage.mjs` | Storage 파일 복사와 owner 맞추기 |
| `deploy/nuc7/smoke.mjs` | 띄운 스택을 밖에서 확인 |
| `apps/web/Dockerfile`, `.dockerignore` | 웹 이미지 |
| `apps/web/next.config.ts` | `output: 'standalone'`, 추적 루트 |
| `.github/workflows/images.yml` | PR에서는 빌드만, main CI 통과 뒤 GHCR에 올림 |
| `tests/self-host-env.test.mjs`, `tests/self-host-counts.test.mjs`, `tests/self-host-storage.test.mjs` | 순수 함수 단위 테스트(`pnpm test`에 들어간다) |
| `apps/web/vercel.json` | 전환 때만 추가: 옛 Vercel 주소를 새 주소로 넘김 |

작업은 두 부분이다. **A(Task 0~8)** 는 저장소 안의 코드이고 개발 PC에서 끝까지 검증한다. **B(Task 9~16)** 는 서버와 외부 계정 작업이고 사용자의 sudo·대시보드 조작과 승인이 필요하다.

---

## A. 저장소 작업

### Task 0: 브랜치 정리

**Files:** 없음

- [ ] **Step 1: 브랜치 이름을 코드가 들어가는 이름으로 바꾼다** (아직 push 전이다)

```bash
git branch -m docs/self-hosting feat/self-hosting
git branch --show-current
```
Expected: `feat/self-hosting`

- [ ] **Step 2: 줄 끝 규칙을 넣는다** — `.gitattributes`를 새로 만든다.

```gitattributes
# 컨테이너와 Linux 서버에서 쓰는 파일은 Windows에서도 LF로 둔다.
*.sh text eol=lf
deploy/nuc7/** text eol=lf
```

- [ ] **Step 3: env 예시가 무시되지 않게 한다** — `.gitignore` 맨 끝의 `.env*` 줄이 앞의 `!.env.example`을 덮으므로, 파일 맨 끝에 덧붙인다.

```gitignore

# 운영 env 예시는 저장소에 둔다. 실제 env(.env, .env.local)는 위 규칙대로 무시된다.
!deploy/nuc7/.env.example
```

- [ ] **Step 4: Commit**

```bash
git add .gitattributes .gitignore
git commit -m "chore: keep deploy files LF and track the nuc7 env example"
```

### Task 1: env 파일 만들기 (`init-env.mjs`)

**Files:**
- Create: `deploy/nuc7/bin/init-env.mjs`
- Test: `tests/self-host-env.test.mjs`

**Interfaces:**
- Produces:
  - `parseEnv(text: string): Map<string, string>` — `KEY=value`, `KEY="value"`(\n·\"·\\ 풀기), `KEY='value'`, `export KEY=…`, `#` 주석과 빈 줄을 읽는다.
  - `quote(value: string): string` — `[A-Za-z0-9_@%+=:,./-]`만 있으면 그대로, 아니면 작은따옴표로 감싼다. 작은따옴표나 줄바꿈이 든 값은 값을 드러내지 않는 오류를 던진다.
  - `signJwt(payload: object, secret: string): string` — HS256.
  - `buildEnv({ local?: boolean, imports?: Map<string,string>[], now?: number, random?: (n:number)=>Buffer }): { text: string, blanks: string[] }`
  - `IMPORTED: string[]`, `DEFAULTS`, `LOCAL_DEFAULTS`
  - CLI: `node deploy/nuc7/bin/init-env.mjs <out> [--local] [--import <file>]...` — `<out>`이 있으면 쓰지 않고 실패한다. 0600으로 쓴다. 비어 있는 키 이름만 stderr에 적고 값은 출력하지 않는다.
- Consumes: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/self-host-env.test.mjs`

```js
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { buildEnv, parseEnv, quote, signJwt } from '../deploy/nuc7/bin/init-env.mjs';

const fixed = (n) => Buffer.alloc(n, 7);
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const verifies = (jwt, secret) => {
  const [head, body, signature] = jwt.split('.');
  return createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url') === signature;
};

test('the anon and service keys are HS256 tokens signed with the new JWT secret', () => {
  const env = parseEnv(buildEnv({ now: 1_800_000_000, random: fixed }).text);
  const secret = env.get('JWT_SECRET');
  assert.equal(secret.length, 64);
  for (const [name, role] of [['ANON_KEY', 'anon'], ['SERVICE_ROLE_KEY', 'service_role']]) {
    const jwt = env.get(name);
    assert.ok(verifies(jwt, secret), `${name} must verify`);
    assert.equal(claims(jwt).role, role);
    assert.equal(claims(jwt).exp - claims(jwt).iat, 10 * 365 * 24 * 3600);
  }
  assert.equal(signJwt({ a: 1 }, 's').split('.').length, 3);
});

test('the worker and the telegram tutor stay off until the cutover, whatever the imports say', () => {
  const imported = new Map([['TELEGRAM_ENABLED', 'true'], ['PACEON_WORKER', 'on'], ['SUPABASE_URL', 'https://old.supabase.co'], ['TELEGRAM_BOT_TOKEN', '123:abc']]);
  const env = parseEnv(buildEnv({ imports: [imported], random: fixed }).text);
  assert.equal(env.get('TELEGRAM_ENABLED'), 'false');
  assert.equal(env.get('PACEON_WORKER'), 'off');
  assert.equal(env.get('SUPABASE_URL'), undefined, 'the old project URL is not carried over');
  assert.equal(env.get('TELEGRAM_BOT_TOKEN'), '123:abc');
});

test('unused asymmetric key slots get a random value so an empty apikey never matches them', () => {
  const env = parseEnv(buildEnv({ random: fixed }).text);
  assert.match(env.get('ENVOY_UNUSED_KEY'), /^unused-[0-9a-f]{64}$/);
  assert.equal(env.get('SUPABASE_PUBLISHABLE_KEY'), undefined);
});

test('values with a dollar sign or spaces survive compose interpolation', () => {
  assert.equal(quote('abc+/='), 'abc+/=');
  assert.equal(quote('pa$$ word'), "'pa$$ word'");
  const env = parseEnv(buildEnv({ imports: [new Map([['OPENAI_API_KEY', 'sk-$HOME x']])], random: fixed }).text);
  assert.equal(env.get('OPENAI_API_KEY'), 'sk-$HOME x');
  assert.throws(() => quote("it's\nsecret"), (error) => !String(error.message).includes('secret'));
});

test('vercel env pull files are read with their quotes and escapes', () => {
  const env = parseEnv('# Created by Vercel CLI\nGOOGLE_CLIENT_ID="abc.apps"\nexport A=1\r\nB=\'x y\'\nC="line\\nnext"\n');
  assert.deepEqual([...env], [['GOOGLE_CLIENT_ID', 'abc.apps'], ['A', '1'], ['B', 'x y'], ['C', 'line\nnext']]);
});

test('two different VAPID public keys stop the build instead of breaking push later', () => {
  const vercel = new Map([['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'one']]);
  const vps = new Map([['VAPID_PUBLIC_KEY', 'two']]);
  assert.throws(() => buildEnv({ imports: [vercel, vps], random: fixed }), /VAPID/);
  const same = parseEnv(buildEnv({ imports: [new Map([['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'k']]), new Map([['VAPID_PUBLIC_KEY', 'k']])], random: fixed }).text);
  assert.equal(same.get('VAPID_PUBLIC_KEY'), 'k');
});

test('the local variant points at the local gateway and confirms mail by itself', () => {
  const env = parseEnv(buildEnv({ local: true, random: fixed }).text);
  assert.equal(env.get('SUPABASE_PUBLIC_URL'), 'http://api-gw.localhost:8000');
  assert.equal(env.get('SITE_URL'), 'http://localhost:13000');
  assert.equal(env.get('ENABLE_EMAIL_AUTOCONFIRM'), 'true');
});

test('blank keys are reported by name so they can be filled by hand', () => {
  const { blanks } = buildEnv({ random: fixed });
  for (const name of ['SMTP_PASS', 'CLOUDFLARE_TUNNEL_TOKEN', 'BACKUP_AGE_RECIPIENT', 'HC_BACKUP_URL', 'HC_DEPLOY_URL', 'GEMINI_API_KEY']) assert.ok(blanks.includes(name), name);
});

test('the CLI never overwrites an existing env file and writes it owner-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paceon-env-'));
  const out = join(dir, '.env');
  const first = spawnSync(process.execPath, ['deploy/nuc7/bin/init-env.mjs', out], { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.doesNotMatch(first.stdout + first.stderr, /eyJ/, 'no key is printed');
  if (process.platform !== 'win32') assert.equal(statSync(out).mode & 0o777, 0o600);
  const before = readFileSync(out, 'utf8');
  const second = spawnSync(process.execPath, ['deploy/nuc7/bin/init-env.mjs', out], { encoding: 'utf8' });
  assert.notEqual(second.status, 0);
  assert.equal(readFileSync(out, 'utf8'), before);
  writeFileSync(join(dir, 'vps.env'), 'GEMINI_API_KEY=g\n');
  const third = spawnSync(process.execPath, ['deploy/nuc7/bin/init-env.mjs', join(dir, 'other.env'), '--import', join(dir, 'vps.env')], { encoding: 'utf8' });
  assert.equal(third.status, 0, third.stderr);
  assert.equal(parseEnv(readFileSync(join(dir, 'other.env'), 'utf8')).get('GEMINI_API_KEY'), 'g');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test tests/self-host-env.test.mjs`
Expected: FAIL — `Cannot find module '…/deploy/nuc7/bin/init-env.mjs'`

- [ ] **Step 3: 구현한다** — `deploy/nuc7/bin/init-env.mjs`

```js
#!/usr/bin/env node
// nuc7 스택의 env 파일을 한 번 만든다. 새 Supabase 비밀 값을 만들고, 운영(Vercel·VPS)에서 옮겨야 하는 값만 가져온다.
// 이미 있는 파일은 절대 덮어쓰지 않는다. JWT secret이 바뀌면 모든 키와 세션이 무효가 되기 때문이다.
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  PACEON_DATA: '/opt/paceon/data',
  PACEON_TAG: 'main',
  // 전환 전에는 꺼 둔다. 리허설 데이터로 알림·텔레그램·AI 작업이 두 번 나가지 않게 한다.
  PACEON_WORKER: 'off',
  TELEGRAM_ENABLED: 'false',
  SUPABASE_PUBLIC_URL: 'https://paceon-api.nolzza.net',
  SITE_URL: 'https://paceon.nolzza.net',
  ADDITIONAL_REDIRECT_URLS: 'https://paceon.nolzza.net/**',
  JWT_EXPIRY: '3600',
  ENABLE_EMAIL_AUTOCONFIRM: 'false',
  DASHBOARD_USERNAME: 'paceon',
  SMTP_HOST: 'smtp.resend.com',
  SMTP_PORT: '465',
  SMTP_USER: 'resend',
  SMTP_PASS: '',
  SMTP_ADMIN_EMAIL: 'noreply@nolzza.net',
  SMTP_SENDER_NAME: 'PaceOn',
  CLOUDFLARE_TUNNEL_TOKEN: '',
  BACKUP_REMOTE: 'r2:paceon-backup',
  BACKUP_AGE_RECIPIENT: '',
  HC_DEPLOY_URL: '',
  HC_BACKUP_URL: '',
};

export const LOCAL_DEFAULTS = {
  ...DEFAULTS,
  PACEON_DATA: './.local-data',
  PACEON_TAG: 'local',
  // 브라우저는 *.localhost를 127.0.0.1로 풀고, 컨테이너는 compose 별칭으로 Envoy를 찾는다. 같은 주소가 양쪽에서 맞는다.
  SUPABASE_PUBLIC_URL: 'http://api-gw.localhost:8000',
  SITE_URL: 'http://localhost:13000',
  ADDITIONAL_REDIRECT_URLS: 'http://localhost:13000/**',
  ENABLE_EMAIL_AUTOCONFIRM: 'true',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '2500',
  SMTP_USER: 'local',
  SMTP_PASS: 'local',
};

// 운영에서 그대로 옮기는 값. 이 목록 밖의 키(옛 SUPABASE_URL, TELEGRAM_ENABLED 등)는 가져오지 않는다.
export const IMPORTED = [
  'AI_ENABLED', 'PDF_ENABLED',
  'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_TRANSCRIBE_MODEL', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_VOICE', 'AI_POLL_SECONDS',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'NOTIFY_POLL_SECONDS',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_DAILY_TURN_LIMIT', 'GEMINI_API_KEY', 'GEMINI_MODEL',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'YOUTUBE_TOKEN_ENCRYPTION_KEY',
];
const OPTIONAL = new Set(['OPENAI_TRANSCRIBE_MODEL', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_VOICE', 'AI_POLL_SECONDS', 'NOTIFY_POLL_SECONDS', 'TELEGRAM_DAILY_TURN_LIMIT']);

export function parseEnv(text) {
  const values = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c));
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

export function quote(value) {
  if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
  if (value.includes("'") || value.includes('\n')) throw new Error('작은따옴표나 줄바꿈이 든 값은 env 파일에 안전하게 쓸 수 없습니다.');
  // 작은따옴표 안은 compose가 $를 보간하지 않는다.
  return `'${value}'`;
}

export function signJwt(payload, secret) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

function generated(now, random) {
  const jwtSecret = random(32).toString('hex');
  const exp = now + 10 * 365 * 24 * 3600;
  return {
    POSTGRES_PASSWORD: random(24).toString('hex'),
    JWT_SECRET: jwtSecret,
    ANON_KEY: signJwt({ role: 'anon', iss: 'supabase', iat: now, exp }, jwtSecret),
    SERVICE_ROLE_KEY: signJwt({ role: 'service_role', iss: 'supabase', iat: now, exp }, jwtSecret),
    // Envoy 설정은 비대칭 키 자리를 빈 값과 정확히 비교한다. 비워 두면 빈 apikey 헤더가 통과하므로 아무도 모르는 값을 넣는다.
    ENVOY_UNUSED_KEY: `unused-${random(32).toString('hex')}`,
    DASHBOARD_PASSWORD: random(18).toString('hex'),
    PG_META_CRYPTO_KEY: random(24).toString('hex'),
  };
}

export function buildEnv({ local = false, imports = [], now = Math.floor(Date.now() / 1000), random = randomBytes } = {}) {
  const taken = new Map();
  for (const source of imports) {
    const vapid = source.get('NEXT_PUBLIC_VAPID_PUBLIC_KEY');
    if (vapid !== undefined) {
      if (taken.has('VAPID_PUBLIC_KEY') && taken.get('VAPID_PUBLIC_KEY') !== vapid) throw new Error('가져온 VAPID 공개키가 서로 다릅니다.');
      taken.set('VAPID_PUBLIC_KEY', vapid);
    }
    for (const name of IMPORTED) {
      if (!source.has(name)) continue;
      const value = source.get(name);
      if (name === 'VAPID_PUBLIC_KEY' && taken.has(name) && taken.get(name) !== value) throw new Error('가져온 VAPID 공개키가 서로 다릅니다.');
      taken.set(name, value);
    }
  }
  const sections = [
    ['# 배포와 주소', local ? LOCAL_DEFAULTS : DEFAULTS],
    ['# Supabase 비밀 값 (init-env.mjs가 만듦. 바꾸면 모든 키와 세션이 무효가 된다)', generated(now, random)],
    ['# 운영에서 옮긴 값', Object.fromEntries(IMPORTED.filter((name) => taken.has(name) || !OPTIONAL.has(name)).map((name) => [name, taken.get(name) ?? '']))],
  ];
  const blanks = [];
  const lines = [];
  for (const [title, values] of sections) {
    lines.push(title);
    for (const [name, value] of Object.entries(values)) {
      if (value === '') blanks.push(name);
      try {
        lines.push(`${name}=${quote(value)}`);
      } catch {
        throw new Error(`${name}: 작은따옴표나 줄바꿈이 든 값은 env 파일에 안전하게 쓸 수 없습니다.`);
      }
    }
    lines.push('');
  }
  return { text: lines.join('\n'), blanks };
}

function main(argv) {
  const out = argv[0];
  if (!out || out.startsWith('--')) throw new Error('사용법: init-env.mjs <out> [--local] [--import <file>]...');
  const imports = [];
  let local = false;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--local') local = true;
    else if (argv[i] === '--import') imports.push(parseEnv(readFileSync(argv[(i += 1)], 'utf8')));
    else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  const { text, blanks } = buildEnv({ local, imports });
  writeFileSync(out, text, { mode: 0o600, flag: 'wx' });
  console.error(`${out}을 만들었습니다.`);
  if (blanks.length) console.error(`직접 채울 값: ${blanks.join(', ')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.code === 'EEXIST' ? '이미 있는 env 파일은 덮어쓰지 않습니다.' : error.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `node --test tests/self-host-env.test.mjs`
Expected: PASS (9 tests)

- [ ] **Step 5: 전체 단위 테스트가 새 파일을 집는지 확인한다**

Run: `pnpm test`
Expected: PASS, 기존 481개 + 9개

- [ ] **Step 6: Commit**

```bash
git add deploy/nuc7/bin/init-env.mjs tests/self-host-env.test.mjs
git commit -m "feat: generate the nuc7 env file once with fresh Supabase keys"
```

### Task 2: 행 수와 내용 대조 (`counts.sql`, `verify-counts.mjs`)

**Files:**
- Create: `deploy/nuc7/migrate/counts.sql`, `deploy/nuc7/migrate/verify-counts.mjs`
- Test: `tests/self-host-counts.test.mjs`

**Interfaces:**
- Produces:
  - `counts.sql`: 결과 열 하나(`line`), 행마다 `schema.table,rows,md5`. md5는 `public`·`private`·`learning_private`에만, 나머지(`auth.users`, `auth.identities`, `storage.objects`)는 빈 칸.
  - `parseCounts(text: string): Map<string, { rows: number, hash: string }>` — `psql -At` 출력과 `supabase db query -o csv` 출력(머리줄 `line`, 값이 큰따옴표로 감싸일 수 있음)을 모두 읽는다.
  - `compareCounts(expected, actual): { table: string, expected: string|null, actual: string|null }[]`
  - CLI: `node deploy/nuc7/migrate/verify-counts.mjs <expected> <actual>` — 차이가 있거나 어느 한쪽에서 테이블을 하나도 못 읽으면 종료 코드 1.
- Consumes: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/self-host-counts.test.mjs`

```js
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { compareCounts, parseCounts } from '../deploy/nuc7/migrate/verify-counts.mjs';

test('psql lines and supabase csv output are read the same way', () => {
  const psql = 'public.resources,3,abc\nauth.users,1,\n';
  const csv = 'line\n"public.resources,3,abc"\n"auth.users,1,"\n';
  assert.deepEqual(parseCounts(psql), parseCounts(csv));
  assert.deepEqual(parseCounts(psql).get('public.resources'), { rows: 3, hash: 'abc' });
});

test('a changed row with the same count is still a difference', () => {
  const a = parseCounts('public.resources,3,abc\n');
  const b = parseCounts('public.resources,3,abd\n');
  assert.deepEqual(compareCounts(a, b), [{ table: 'public.resources', expected: '3 abc', actual: '3 abd' }]);
});

test('a table missing on one side is a difference', () => {
  const diff = compareCounts(parseCounts('public.a,1,x\npublic.b,0,y\n'), parseCounts('public.a,1,x\n'));
  assert.deepEqual(diff, [{ table: 'public.b', expected: '0 y', actual: null }]);
});

test('an unreadable file fails instead of passing as "no differences"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paceon-counts-'));
  writeFileSync(join(dir, 'a.csv'), 'public.a,1,x\n');
  writeFileSync(join(dir, 'empty.csv'), 'Initialising login role...\n');
  const run = (x, y) => spawnSync(process.execPath, ['deploy/nuc7/migrate/verify-counts.mjs', join(dir, x), join(dir, y)], { encoding: 'utf8' });
  assert.equal(run('a.csv', 'a.csv').status, 0);
  assert.notEqual(run('empty.csv', 'empty.csv').status, 0);
  assert.notEqual(run('a.csv', 'empty.csv').status, 0);
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test tests/self-host-counts.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: SQL을 쓴다** — `deploy/nuc7/migrate/counts.sql`

```sql
-- 이전과 백업이 지켜야 할 테이블마다 "schema.table,행 수,내용 해시" 한 줄.
-- 내용 해시는 앱 스키마에만 둔다. auth 테이블은 GoTrue 버전마다 열이 달라 행 수만 비교한다.
-- 시각 값의 글자는 세션 TimeZone에 따른다. Cloud와 nuc7 모두 UTC다(Task 3에서 확인).
select format('%s.%s,%s,%s', n.nspname, c.relname,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text,
  case when n.nspname in ('public', 'private', 'learning_private') then
    (xpath('/row/h/text()', query_to_xml(
      format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as h from %I.%I t', E'\n', '', n.nspname, c.relname),
      false, true, '')))[1]::text
  else '' end) as line
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and (n.nspname in ('public', 'private', 'learning_private')
       or (n.nspname, c.relname) in (('auth', 'users'), ('auth', 'identities'), ('storage', 'objects')))
order by 1;
```

- [ ] **Step 4: 비교기를 쓴다** — `deploy/nuc7/migrate/verify-counts.mjs`

```js
#!/usr/bin/env node
// counts.sql의 결과 두 개를 비교한다. 행 수나 내용 해시가 다른 테이블을 모두 적는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function parseCounts(text) {
  const counts = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^"(.*)"$/, '$1');
    const match = /^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*),(\d+),([0-9a-f]*)$/.exec(line);
    if (match) counts.set(match[1], { rows: Number(match[2]), hash: match[3] });
  }
  return counts;
}

const show = (entry) => (entry ? `${entry.rows} ${entry.hash}`.trim() : null);

export function compareCounts(expected, actual) {
  const names = [...new Set([...expected.keys(), ...actual.keys()])].sort();
  return names
    .map((table) => ({ table, expected: show(expected.get(table)), actual: show(actual.get(table)) }))
    .filter((row) => row.expected !== row.actual);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [expectedFile, actualFile] = process.argv.slice(2);
  const expected = parseCounts(readFileSync(expectedFile, 'utf8'));
  const actual = parseCounts(readFileSync(actualFile, 'utf8'));
  if (!expected.size || !actual.size) {
    console.error(`테이블을 읽지 못했습니다(기준 ${expected.size}개, 대상 ${actual.size}개). 파일 내용을 확인하세요.`);
    process.exit(1);
  }
  const differences = compareCounts(expected, actual);
  for (const row of differences) console.error(`다름 ${row.table}: 기준 ${row.expected ?? '없음'} / 대상 ${row.actual ?? '없음'}`);
  console.log(differences.length ? `${differences.length}개 테이블이 다릅니다.` : `${expected.size}개 테이블이 모두 같습니다.`);
  process.exit(differences.length ? 1 : 0);
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `node --test tests/self-host-counts.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 6: 로컬 Supabase에서 SQL이 도는지 확인한다** (Supabase Local이 떠 있어야 한다: `supabase start`)

Run: `supabase db query --local -o csv -f deploy/nuc7/migrate/counts.sql | head -5`
Expected: 첫 줄 `line`, 다음 줄부터 `"learning_private.…,0,d41d8cd98f00b204e9800998ecf8427e"` 형태(빈 테이블의 md5는 빈 문자열의 md5)

- [ ] **Step 7: Commit**

```bash
git add deploy/nuc7/migrate/counts.sql deploy/nuc7/migrate/verify-counts.mjs tests/self-host-counts.test.mjs
git commit -m "feat: compare row counts and content hashes between two databases"
```

### Task 3: Supabase 스택 정의와 smoke (`compose.yaml`, `smoke.mjs`)

**Files:**
- Create: `deploy/nuc7/supabase/SOURCE.md`, `deploy/nuc7/supabase/envoy/{envoy.yaml,cds.yaml,lds.template.yaml,docker-entrypoint.sh}`, `deploy/nuc7/supabase/db/{roles.sql,jwt.sql,webhooks.sql}` (복사)
- Create: `deploy/nuc7/compose.yaml`, `deploy/nuc7/compose.local.yaml`, `deploy/nuc7/.env.example`, `deploy/nuc7/smoke.mjs`

**Interfaces:**
- Consumes: Task 1의 env 키 이름(`ANON_KEY`, `SERVICE_ROLE_KEY`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `ENVOY_UNUSED_KEY`, `SUPABASE_PUBLIC_URL`, `SITE_URL` …), `parseEnv`.
- Produces:
  - compose 서비스 이름: `db`, `auth`, `rest`, `storage`, `api-gw`(별칭 `envoy`, `kong`), `web`, `ai-worker`(profile `worker`), `cloudflared`(profile `tunnel`), `studio`·`meta`(profile `admin`). 네트워크 `paceon_default`.
  - 로컬 포트: db `127.0.0.1:15432`, api-gw `127.0.0.1:8000`, web `127.0.0.1:13000`. 운영 포트: db `127.0.0.1:5432`, studio `127.0.0.1:3001`.
  - `smoke.mjs` CLI: `node deploy/nuc7/smoke.mjs --env-file <file> --api <url> [--web <url>] [--login]`. 실패가 있으면 종료 코드 1.

- [ ] **Step 1: 실패하는 smoke를 쓴다** — `deploy/nuc7/smoke.mjs`

```js
#!/usr/bin/env node
// 떠 있는 PaceOn 스택을 밖에서 확인한다: API가 답하고, 키가 제 권한만 갖고, 관리자 경로는 닫혀 있고, 웹이 뜬다.
// --login은 임시 사용자를 만들어 로그인과 RLS 조회를 해 보고 지운다. 비밀번호는 실행 중에만 만든다.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from './bin/init-env.mjs';

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const env = parseEnv(readFileSync(option('--env-file'), 'utf8'));
const api = (option('--api') ?? env.get('SUPABASE_PUBLIC_URL')).replace(/\/$/, '');
const web = option('--web')?.replace(/\/$/, '');
const anon = env.get('ANON_KEY');
const service = env.get('SERVICE_ROLE_KEY');
const as = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
const call = (url, init = {}) => fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });

const checks = [
  ['Auth가 답한다', async () => (await call(`${api}/auth/v1/health`, { headers: { apikey: anon } })).status === 200],
  ['anon 키로 REST를 읽으면 RLS 때문에 빈 목록이다', async () => {
    const response = await call(`${api}/rest/v1/resources?select=id&limit=1`, { headers: as(anon) });
    return response.status === 200 && JSON.stringify(await response.json()) === '[]';
  }],
  ['빈 apikey로는 REST가 열리지 않는다', async () => (await call(`${api}/rest/v1/`, { headers: { apikey: '' } })).status !== 200],
  ['anon 키로는 관리자 전용 OpenAPI가 열리지 않는다', async () => (await call(`${api}/rest/v1/`, { headers: as(anon) })).status !== 200],
  ['service 키로 Storage 버킷 두 개가 보인다', async () => {
    const response = await call(`${api}/storage/v1/bucket`, { headers: as(service) });
    const ids = response.status === 200 ? (await response.json()).map((bucket) => bucket.id) : [];
    return ids.includes('learning-pdfs') && ids.includes('learning-audio');
  }],
  ['pg-meta는 service 키로도 닫혀 있다', async () => (await call(`${api}/pg/tables`, { headers: as(service) })).status !== 200],
];
if (web) {
  checks.push(
    ['웹 상태 확인이 ok다', async () => { const r = await call(`${web}/api/health`); return r.status === 200 && (await r.json()).status === 'ok'; }],
    ['로그인 화면이 뜬다', async () => (await call(`${web}/login`)).status === 200],
    ['서비스 워커가 있다', async () => (await call(`${web}/sw.js`)).status === 200],
  );
}
if (args.includes('--login')) {
  checks.push(['임시 사용자가 비밀번호로 로그인하고 자기 행만 읽는다', async () => {
    const email = `smoke-${randomBytes(4).toString('hex')}@example.test`;
    const password = randomBytes(18).toString('base64url');
    const created = await call(`${api}/auth/v1/admin/users`, { method: 'POST', headers: { ...as(service), 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    if (created.status !== 200) return false;
    const { id } = await created.json();
    try {
      const token = await call(`${api}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      if (token.status !== 200) return false;
      const { access_token: accessToken } = await token.json();
      const rows = await call(`${api}/rest/v1/resources?select=id`, { headers: { apikey: anon, Authorization: `Bearer ${accessToken}` } });
      return rows.status === 200 && Array.isArray(await rows.json());
    } finally {
      await call(`${api}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: as(service) });
    }
  }]);
}

let failed = 0;
for (const [name, check] of checks) {
  let ok = false;
  try { ok = await check(); } catch (error) { console.error(`  ${error.cause?.code ?? error.message}`); }
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}
console.log(failed ? `${failed}개 실패` : `${checks.length}개 모두 통과`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: 실패를 확인한다** (아직 스택이 없다)

```bash
node deploy/nuc7/bin/init-env.mjs deploy/nuc7/.env.local --local
node deploy/nuc7/smoke.mjs --env-file deploy/nuc7/.env.local --api http://127.0.0.1:8000
```
Expected: `✗ Auth가 답한다` … `6개 실패`, 종료 코드 1

- [ ] **Step 3: 공식 파일을 고정 커밋에서 복사한다**

```bash
sha=ff80bb14991e68667c04f74248b954e8babe6fde
base="https://raw.githubusercontent.com/supabase/supabase/$sha/docker/volumes"
mkdir -p deploy/nuc7/supabase/envoy deploy/nuc7/supabase/db
for f in envoy.yaml cds.yaml lds.template.yaml docker-entrypoint.sh; do curl -fsSL "$base/api/envoy/$f" -o "deploy/nuc7/supabase/envoy/$f"; done
for f in roles.sql jwt.sql webhooks.sql; do curl -fsSL "$base/db/$f" -o "deploy/nuc7/supabase/db/$f"; done
ls -l deploy/nuc7/supabase/envoy deploy/nuc7/supabase/db
```
Expected: 파일 7개, 모두 0바이트가 아님. `lds.template.yaml` 약 1200줄.

`deploy/nuc7/supabase/SOURCE.md`:

```markdown
# 출처

`supabase/supabase` 저장소 커밋 `ff80bb14991e68667c04f74248b954e8babe6fde`의 `docker/volumes/`에서 그대로 복사했다. 고치지 않는다.

| 이 폴더 | 원본 |
| --- | --- |
| `envoy/*` | `docker/volumes/api/envoy/*` (API 관문. `/pg/`는 모두 거절, `/auth`·`/rest`는 anon·service 키가 있어야 통과) |
| `db/roles.sql` | 서비스 역할 비밀번호를 `POSTGRES_PASSWORD`로 맞춘다 |
| `db/jwt.sql` | `app.settings.jwt_exp` |
| `db/webhooks.sql` | `supabase_functions` 스키마(Cloud와 같게) |

쓰지 않아 복사하지 않은 것: `realtime.sql`, `logs.sql`, `pooler.sql`, `_supabase.sql`(Realtime·로그 분석·풀러용).

버전을 올릴 때는 새 커밋에서 같은 파일을 다시 받고, `compose.yaml`의 이미지 버전을 그 커밋의 `docker/docker-compose.yml`과 맞춘 뒤 Task 3의 로컬 확인을 다시 한다.
```

- [ ] **Step 4: 운영 compose를 쓴다** — `deploy/nuc7/compose.yaml`

```yaml
# PaceOn 운영 스택 (nuc7). 설계: docs/SELF_HOSTING.md
# nuc7에서는 bin/compose로 부른다(env 파일과 profile을 붙인다).
name: paceon

x-logging: &logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"

services:
  db:
    image: supabase/postgres:17.6.1.136
    restart: unless-stopped
    logging: *logging
    mem_limit: 1g
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - ./supabase/db/webhooks.sql:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:ro
      - ./supabase/db/roles.sql:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro
      - ./supabase/db/jwt.sql:/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql:ro
      - ${PACEON_DATA}/db:/var/lib/postgresql/data
      - db-config:/etc/postgresql-custom
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres", "-h", "localhost"]
      interval: 5s
      timeout: 5s
      retries: 10
    environment:
      POSTGRES_HOST: /var/run/postgresql
      PGPORT: 5432
      POSTGRES_PORT: 5432
      PGPASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      PGDATABASE: postgres
      POSTGRES_DB: postgres
      JWT_EXP: ${JWT_EXPIRY}
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "log_min_messages=fatal"]

  auth:
    image: supabase/gotrue:v2.196.0
    restart: unless-stopped
    logging: *logging
    mem_limit: 128m
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:9999/health"]
      interval: 5s
      timeout: 5s
      retries: 3
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      GOTRUE_API_PORT: 9999
      API_EXTERNAL_URL: ${SUPABASE_PUBLIC_URL}/auth/v1
      GOTRUE_DB_DRIVER: postgres
      GOTRUE_DB_DATABASE_URL: postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      GOTRUE_SITE_URL: ${SITE_URL}
      GOTRUE_URI_ALLOW_LIST: ${ADDITIONAL_REDIRECT_URLS}
      GOTRUE_DISABLE_SIGNUP: "false"
      GOTRUE_JWT_ADMIN_ROLES: service_role
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_JWT_EXP: ${JWT_EXPIRY}
      GOTRUE_JWT_SECRET: ${JWT_SECRET}
      GOTRUE_JWT_ISSUER: ${SUPABASE_PUBLIC_URL}/auth/v1
      GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
      GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: "false"
      GOTRUE_EXTERNAL_PHONE_ENABLED: "false"
      GOTRUE_MAILER_AUTOCONFIRM: ${ENABLE_EMAIL_AUTOCONFIRM}
      GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_ADMIN_EMAIL}
      GOTRUE_SMTP_HOST: ${SMTP_HOST}
      GOTRUE_SMTP_PORT: ${SMTP_PORT}
      GOTRUE_SMTP_USER: ${SMTP_USER}
      GOTRUE_SMTP_PASS: ${SMTP_PASS}
      GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME}
      GOTRUE_MAILER_URLPATHS_INVITE: /auth/v1/verify
      GOTRUE_MAILER_URLPATHS_CONFIRMATION: /auth/v1/verify
      GOTRUE_MAILER_URLPATHS_RECOVERY: /auth/v1/verify
      GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE: /auth/v1/verify

  rest:
    image: postgrest/postgrest:v14.17
    restart: unless-stopped
    logging: *logging
    mem_limit: 128m
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "postgrest", "--ready"]
      interval: 5s
      timeout: 5s
      retries: 3
    environment:
      PGRST_DB_URI: postgres://authenticator:${POSTGRES_PASSWORD}@db:5432/postgres
      # supabase/config.toml의 [api] 설정과 같게 둔다.
      PGRST_DB_SCHEMAS: public,graphql_public
      PGRST_DB_MAX_ROWS: 1000
      PGRST_DB_EXTRA_SEARCH_PATH: public,extensions
      PGRST_DB_ANON_ROLE: anon
      PGRST_ADMIN_SERVER_PORT: 3001
      PGRST_ADMIN_SERVER_HOST: localhost
      PGRST_JWT_SECRET: ${JWT_SECRET}
      PGRST_DB_USE_LEGACY_GUCS: "false"
      PGRST_APP_SETTINGS_JWT_EXP: ${JWT_EXPIRY}
    command: ["postgrest"]

  storage:
    image: supabase/storage-api:v1.74.0
    restart: unless-stopped
    logging: *logging
    mem_limit: 256m
    depends_on:
      db:
        condition: service_healthy
      rest:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:5000/status"]
      interval: 5s
      timeout: 5s
      retries: 3
      start_period: 10s
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_KEY: ${SERVICE_ROLE_KEY}
      POSTGREST_URL: http://rest:3000
      AUTH_JWT_SECRET: ${JWT_SECRET}
      DATABASE_URL: postgres://supabase_storage_admin:${POSTGRES_PASSWORD}@db:5432/postgres
      STORAGE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
      REQUEST_ALLOW_X_FORWARDED_PATH: "true"
      FILE_SIZE_LIMIT: 52428800
      STORAGE_BACKEND: file
      GLOBAL_S3_BUCKET: stub
      FILE_STORAGE_BACKEND_PATH: /var/lib/storage
      TENANT_ID: stub
      REGION: stub
      ENABLE_IMAGE_TRANSFORMATION: "false"
    volumes:
      - ${PACEON_DATA}/storage:/var/lib/storage

  api-gw:
    image: envoyproxy/envoy:v1.39.1
    restart: unless-stopped
    logging: *logging
    mem_limit: 256m
    networks:
      default:
        aliases: [envoy, kong]
    depends_on:
      auth:
        condition: service_healthy
      rest:
        condition: service_healthy
      storage:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "timeout 1 bash -c '</dev/tcp/127.0.0.1/8000'"]
      interval: 10s
      timeout: 5s
      retries: 3
    volumes:
      - ./supabase/envoy/envoy.yaml:/etc/envoy/envoy.yaml:ro
      - ./supabase/envoy/cds.yaml:/etc/envoy/cds.yaml:ro
      - ./supabase/envoy/lds.template.yaml:/etc/envoy/lds.template.yaml:ro
      - ./supabase/envoy/docker-entrypoint.sh:/docker-entrypoint.sh:ro
    environment:
      ANON_KEY: ${ANON_KEY}
      SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      # 새 형식 키는 쓰지 않는다(docs/SELF_HOSTING.md "키"). 비대칭 키 자리는 빈 apikey가 맞지 않게 임의 값으로 채운다.
      SUPABASE_PUBLISHABLE_KEY: ""
      SUPABASE_SECRET_KEY: ""
      ANON_KEY_ASYMMETRIC: ${ENVOY_UNUSED_KEY}
      SERVICE_ROLE_KEY_ASYMMETRIC: ${ENVOY_UNUSED_KEY}
      SUPABASE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
      DASHBOARD_USERNAME: ${DASHBOARD_USERNAME}
      DASHBOARD_PASSWORD: ${DASHBOARD_PASSWORD}
    entrypoint: ["/bin/sh", "/docker-entrypoint.sh"]

  web:
    image: ghcr.io/gnghkim/paceon-web:${PACEON_TAG}
    restart: unless-stopped
    logging: *logging
    mem_limit: 512m
    depends_on:
      api-gw:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
    environment:
      # NEXT_PUBLIC_*는 이미지에 박혀 있지만, process.env를 통째로 읽는 서버 코드(youtube-oauth.ts)를 위해 실행 때도 넣는다.
      NEXT_PUBLIC_SUPABASE_URL: ${SUPABASE_PUBLIC_URL}
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ${ANON_KEY}
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      APP_URL: ${SITE_URL}
      AI_ENABLED: ${AI_ENABLED:-false}
      PDF_ENABLED: ${PDF_ENABLED:-false}
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      YOUTUBE_TOKEN_ENCRYPTION_KEY: ${YOUTUBE_TOKEN_ENCRYPTION_KEY:-}
      TELEGRAM_BOT_USERNAME: ${TELEGRAM_BOT_USERNAME:-}

  ai-worker:
    image: ghcr.io/gnghkim/paceon-ai-worker:${PACEON_TAG}
    # 전환 전에는 띄우지 않는다. bin/compose가 PACEON_WORKER=on일 때만 이 profile을 켠다.
    profiles: [worker]
    restart: unless-stopped
    init: true
    stop_grace_period: 180s
    logging: *logging
    mem_limit: 768m
    depends_on:
      api-gw:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
      interval: 10s
      timeout: 5s
      start_period: 10s
      retries: 5
    environment:
      AI_ENABLED: ${AI_ENABLED:-false}
      PDF_ENABLED: ${PDF_ENABLED:-false}
      SUPABASE_URL: http://api-gw:8000
      SUPABASE_SERVICE_ROLE_KEY: ${SERVICE_ROLE_KEY}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
      OPENAI_MODEL: ${OPENAI_MODEL:-}
      OPENAI_TRANSCRIBE_MODEL: ${OPENAI_TRANSCRIBE_MODEL:-gpt-4o-mini-transcribe}
      OPENAI_TTS_MODEL: ${OPENAI_TTS_MODEL:-gpt-4o-mini-tts}
      OPENAI_TTS_VOICE: ${OPENAI_TTS_VOICE:-marin}
      AI_POLL_SECONDS: ${AI_POLL_SECONDS:-15}
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}
      VAPID_SUBJECT: ${VAPID_SUBJECT:-}
      NOTIFY_POLL_SECONDS: ${NOTIFY_POLL_SECONDS:-60}
      # 한 봇 토큰은 한 곳에서만 읽는다. VPS Worker를 멈춘 뒤에만 true로 바꾼다.
      TELEGRAM_ENABLED: ${TELEGRAM_ENABLED:-false}
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN:-}
      TELEGRAM_DAILY_TURN_LIMIT: ${TELEGRAM_DAILY_TURN_LIMIT:-300}
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
      GEMINI_MODEL: ${GEMINI_MODEL:-gemini-3.5-flash-lite}

  cloudflared:
    image: cloudflare/cloudflared:2026.10.0
    profiles: [tunnel]
    restart: unless-stopped
    logging: *logging
    mem_limit: 128m
    command: ["tunnel", "--no-autoupdate", "run"]
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on:
      api-gw:
        condition: service_healthy

  meta:
    image: supabase/postgres-meta:v0.99.0
    profiles: [admin]
    restart: unless-stopped
    logging: *logging
    depends_on:
      db:
        condition: service_healthy
    environment:
      PG_META_PORT: 8080
      PG_META_DB_HOST: db
      PG_META_DB_PORT: 5432
      PG_META_DB_NAME: postgres
      PG_META_DB_USER: postgres
      PG_META_DB_PASSWORD: ${POSTGRES_PASSWORD}
      CRYPTO_KEY: ${PG_META_CRYPTO_KEY}

  studio:
    image: supabase/studio:2026.09.07-sha-7996410
    profiles: [admin]
    restart: unless-stopped
    logging: *logging
    ports:
      - "127.0.0.1:3001:3000"
    depends_on:
      meta:
        condition: service_started
    environment:
      HOSTNAME: "0.0.0.0"
      STUDIO_PG_META_URL: http://meta:8080
      POSTGRES_PORT: 5432
      POSTGRES_HOST: db
      POSTGRES_DB: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_USER_READ_WRITE: postgres
      PG_META_CRYPTO_KEY: ${PG_META_CRYPTO_KEY}
      PGRST_DB_SCHEMAS: public,graphql_public
      DEFAULT_ORGANIZATION_NAME: PaceOn
      DEFAULT_PROJECT_NAME: PaceOn
      SUPABASE_URL: http://api-gw:8000
      SUPABASE_PUBLIC_URL: ${SUPABASE_PUBLIC_URL}
      SUPABASE_ANON_KEY: ${ANON_KEY}
      SUPABASE_SERVICE_KEY: ${SERVICE_ROLE_KEY}
      AUTH_JWT_SECRET: ${JWT_SECRET}
      ENABLED_FEATURES_LOGS_ALL: "false"

volumes:
  db-config:
```

- [ ] **Step 5: 로컬 덮어쓰기를 쓴다** — `deploy/nuc7/compose.local.yaml`

```yaml
# 개발 PC에서 운영 구성을 그대로 띄워 보는 덮어쓰기. Tunnel 없이 127.0.0.1에 포트를 연다.
#   docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local up -d
# 개발용 Worker(포트 8000)를 띄워 두었다면 먼저 끈다.
services:
  db:
    ports: !override
      - "127.0.0.1:15432:5432"
    volumes:
      # Windows 바인드 마운트는 PGDATA 권한을 지키지 못해 이름 있는 볼륨을 쓴다.
      - local-db:/var/lib/postgresql/data
  storage:
    volumes:
      - local-storage:/var/lib/storage
  api-gw:
    ports:
      - "127.0.0.1:8000:8000"
    networks:
      default:
        aliases: [envoy, kong, api-gw.localhost]
  web:
    image: paceon-web:local
    ports:
      - "127.0.0.1:13000:3000"
  ai-worker:
    image: paceon-ai-worker:local

volumes:
  local-db:
  local-storage:
```

- [ ] **Step 6: env 예시를 쓴다** — `deploy/nuc7/.env.example`. 내용은 아래 명령의 출력에서 값만 지운 것이다(키 순서와 주석을 init-env와 같게 유지한다).

```bash
node -e "import('./deploy/nuc7/bin/init-env.mjs').then(({ buildEnv }) => process.stdout.write(buildEnv({ random: (n) => Buffer.alloc(n) }).text.replace(/^([A-Z_]+)=.*$/gm, (line, key) => ['PACEON_DATA','PACEON_TAG','PACEON_WORKER','TELEGRAM_ENABLED','SUPABASE_PUBLIC_URL','SITE_URL','ADDITIONAL_REDIRECT_URLS','JWT_EXPIRY','ENABLE_EMAIL_AUTOCONFIRM','DASHBOARD_USERNAME','SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_ADMIN_EMAIL','SMTP_SENDER_NAME','BACKUP_REMOTE'].includes(key) ? line : key + '=')))" > deploy/nuc7/.env.example
```
그리고 맨 위에 다음 두 줄을 덧붙인다.

```
# 직접 쓰지 말고 init-env.mjs로 만든다: node deploy/nuc7/bin/init-env.mjs /opt/paceon/.env --import vercel.env --import vps.env
# 만든 뒤 SMTP_PASS, CLOUDFLARE_TUNNEL_TOKEN, BACKUP_AGE_RECIPIENT, HC_* 를 채운다.
```

- [ ] **Step 7: compose가 읽히는지와 Worker가 기본으로 빠지는지 확인한다**

```bash
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local config -q && echo ok
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local config --services
```
Expected: `ok`, 그리고 서비스 목록에 `db auth rest storage api-gw web`이 있고 `ai-worker`, `cloudflared`, `studio`, `meta`는 없다.

- [ ] **Step 8: Supabase 부분만 띄운다**

```bash
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local up -d db auth rest storage api-gw
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local ps
```
Expected: 5개 모두 `healthy`(처음엔 1~2분). `docker compose … logs api-gw`에 `Envoy running in legacy API key mode`가 있다. realtime·functions·studio·meta 호스트를 못 찾는다는 DNS 경고는 괜찮다(쓰지 않는 cluster). `api-gw`가 뜨지 않으면 로그에서 원인을 보고 고친다.

- [ ] **Step 9: migration과 pgTAP을 이 DB에 돌린다** (Git Bash)

```bash
set -a; . deploy/nuc7/.env.local; set +a
url="postgresql://postgres:${POSTGRES_PASSWORD}@127.0.0.1:15432/postgres"
supabase db push --db-url "$url" --yes
supabase test db --db-url "$url"
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local restart rest
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local exec -T db psql -U postgres -h localhost -Atc "show timezone"
```
Expected: migration 전부 적용, pgTAP `All tests successful`(지금 31개 파일 831개), 시간대 `UTC`.
- `supabase test db`가 컨테이너 안에서 `127.0.0.1`에 닿지 못하면 `127.0.0.1`을 `host.docker.internal`로 바꿔 다시 한다. 어느 쪽이 됐는지 Task 7에서 절차서에 적는다.
- pgTAP이 Cloud에서 통과하는데 여기서 실패하면 이미지 버전 차이다. 실패한 테스트와 원인을 적고, 고치기 전에 사용자에게 알린다.

- [ ] **Step 10: smoke를 통과시킨다**

Run: `node deploy/nuc7/smoke.mjs --env-file deploy/nuc7/.env.local --api http://127.0.0.1:8000 --login`
Expected: `7개 모두 통과`. 특히 `빈 apikey로는 REST가 열리지 않는다`가 통과해야 한다. 실패하면 compose의 `*_ASYMMETRIC` 값이 비었는지 본다.

- [ ] **Step 11: Commit**

```bash
git add deploy/nuc7/supabase deploy/nuc7/compose.yaml deploy/nuc7/compose.local.yaml deploy/nuc7/.env.example deploy/nuc7/smoke.mjs
git commit -m "feat: define the nuc7 stack with the parts of self-hosted Supabase PaceOn uses"
```

### Task 4: 웹 이미지 (`Dockerfile`, standalone)

**Files:**
- Modify: `apps/web/next.config.ts`
- Create: `apps/web/Dockerfile`, `.dockerignore`

**Interfaces:**
- Consumes: Task 3의 로컬 스택과 `compose.local.yaml`의 이미지 이름 `paceon-web:local`, `paceon-ai-worker:local`
- Produces: 빌드 인자 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_APP_VERSION`. 실행 파일 `apps/web/server.js`(작업 폴더 `/app`), 포트 3000.

- [ ] **Step 1: 실패를 확인한다** — 아직 Dockerfile이 없다.

Run: `docker build -f apps/web/Dockerfile -t paceon-web:local .`
Expected: FAIL — `failed to read dockerfile`

- [ ] **Step 2: standalone 출력을 켠다** — `apps/web/next.config.ts`

```ts
import path from 'node:path';
import type { NextConfig } from 'next';
import { resolveAppVersion } from './app-version.mjs';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: resolveAppVersion(),
  },
  // nuc7 이미지는 standalone 서버를 쓴다. 모노레포 루트에서 추적해야 workspace 패키지가 함께 들어간다.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@paceon/shared', '@paceon/scheduler', '@paceon/books', '@paceon/ai-schema', '@paceon/pdf-schema'],
};

export default nextConfig;
```

- [ ] **Step 3: 빌드에서 뺄 것을 적는다** — `.dockerignore`(저장소 루트, 웹 이미지 컨텍스트)

```
**/node_modules
**/.next
.git
.vercel
**/.env
**/.env.*
!**/.env.example
services/ai-worker/.venv
supabase/.temp
deploy
docs
tests
.artifacts
.doc-manager
```

- [ ] **Step 4: Dockerfile을 쓴다** — `apps/web/Dockerfile`

```dockerfile
# PaceOn 웹(Next.js standalone). 저장소 루트를 컨텍스트로 빌드한다:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SUPABASE_URL=… .
# NEXT_PUBLIC_* 값은 빌드할 때 브라우저 코드에 박힌다. 공개해도 되는 값만 넣는다.
FROM node:24.14.0-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_APP_VERSION
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
RUN pnpm --filter @paceon/web build

FROM node:24.14.0-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 5: 두 이미지를 로컬 값으로 빌드한다** (Git Bash)

```bash
set -a; . deploy/nuc7/.env.local; set +a
docker build -f apps/web/Dockerfile -t paceon-web:local \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_PUBLIC_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$ANON_KEY" \
  --build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  --build-arg NEXT_PUBLIC_APP_VERSION=local .
docker build -t paceon-ai-worker:local services/ai-worker
docker run --rm paceon-web:local ls apps/web/server.js
```
Expected: 두 빌드 성공, `apps/web/server.js`. standalone 폴더 구조가 다르면(예: `server.js`가 루트에 있음) `ls -R`로 보고 Dockerfile의 COPY와 CMD를 맞춘다.

- [ ] **Step 6: 웹까지 띄워 smoke를 통과시킨다**

```bash
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local up -d web
node deploy/nuc7/smoke.mjs --env-file deploy/nuc7/.env.local --api http://127.0.0.1:8000 --web http://127.0.0.1:13000 --login
```
Expected: `10개 모두 통과`

- [ ] **Step 7: 브라우저에서 가입·로그인·책 담기를 해 본다** — 이 저장소에서 쓰던 playwright-core 스크립트 방식으로(테스트 계정은 스크립트 안에서 만들고 끝나면 지운다).
  1. `http://localhost:13000/login`의 가입에서 `self-host-check@example.test`로 가입(로컬은 메일 확인을 건너뛴다).
  2. 로그인 → 서재에서 책 하나 담기 → 독서 시작 → 독서 기록 창에서 10쪽 기록.
  3. 콘솔 오류가 없고, 390px 폭에서 가로 스크롤이 없다.
  4. admin API로 계정을 지운다.
Expected: 모두 동작. 요청이 `http://api-gw.localhost:8000`으로 가는지 네트워크 로그에서 확인한다.

- [ ] **Step 8: 기존 검사가 그대로인지 확인한다**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: 모두 통과(standalone 출력이 생겨도 `pnpm build`는 그대로 성공한다).

- [ ] **Step 9: Commit**

```bash
git add apps/web/next.config.ts apps/web/Dockerfile .dockerignore
git commit -m "feat: build the web app as a standalone container image"
```

### Task 5: 이미지 워크플로 (`images.yml`)

**Files:**
- Create: `.github/workflows/images.yml`

**Interfaces:**
- Consumes: Task 4의 빌드 인자. GitHub 저장소 Variables `NUC7_SUPABASE_URL`, `NUC7_ANON_KEY`, `NUC7_VAPID_PUBLIC_KEY`(Task 12에서 넣는다)
- Produces: `ghcr.io/gnghkim/paceon-web:{main,sha-<7자리>}`, `ghcr.io/gnghkim/paceon-ai-worker:{main,sha-<7자리>}`

- [ ] **Step 1: 워크플로를 쓴다**

```yaml
name: Images

# PR에서는 이미지가 만들어지는지만 본다. main에서는 CI가 통과한 커밋만 GHCR에 올리고, nuc7 타이머가 당겨 간다.
on:
  pull_request:
    paths:
      - apps/web/Dockerfile
      - apps/web/next.config.ts
      - .dockerignore
      - services/ai-worker/Dockerfile
      - services/ai-worker/requirements.lock
      - .github/workflows/images.yml
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

permissions:
  contents: read
  packages: write

concurrency:
  group: images-${{ github.event_name }}-${{ github.event.workflow_run.head_branch || github.ref }}
  cancel-in-progress: false

jobs:
  build:
    if: github.event_name == 'pull_request' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push')
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - name: paceon-web
            context: .
            file: apps/web/Dockerfile
          - name: paceon-ai-worker
            context: services/ai-worker
            file: services/ai-worker/Dockerfile
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}
      - id: version
        run: |
          echo "sha=$(git rev-parse --short=7 HEAD)" >> "$GITHUB_OUTPUT"
          echo "app=$(git log -1 --format=%cs | tr -d -)-$(git rev-parse --short=7 HEAD)" >> "$GITHUB_OUTPUT"
      - uses: docker/setup-buildx-action@v3
      - if: github.event_name == 'workflow_run'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.file }}
          push: ${{ github.event_name == 'workflow_run' }}
          tags: |
            ghcr.io/gnghkim/${{ matrix.name }}:main
            ghcr.io/gnghkim/${{ matrix.name }}:sha-${{ steps.version.outputs.sha }}
          labels: org.opencontainers.image.source=https://github.com/gnghkim/paceon
          build-args: |
            NEXT_PUBLIC_SUPABASE_URL=${{ vars.NUC7_SUPABASE_URL }}
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${{ vars.NUC7_ANON_KEY }}
            NEXT_PUBLIC_VAPID_PUBLIC_KEY=${{ vars.NUC7_VAPID_PUBLIC_KEY }}
            NEXT_PUBLIC_APP_VERSION=${{ steps.version.outputs.app }}
          cache-from: type=gha,scope=${{ matrix.name }}
          cache-to: type=gha,mode=max,scope=${{ matrix.name }}
```

- [ ] **Step 2: 문법을 검사한다**

Run: `docker run --rm -v "$(pwd -W 2>/dev/null || pwd)":/repo -w /repo rhysd/actionlint:latest -color .github/workflows/images.yml`
Expected: 출력 없음, 종료 코드 0. (Git Bash에서 경로가 깨지면 `MSYS_NO_PATHCONV=1`을 앞에 붙인다.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/images.yml
git commit -m "ci: publish web and worker images to GHCR after CI passes on main"
```
PR에서 실제로 빌드되는지는 Task 12에서 PR을 열 때 확인한다.

### Task 6: 데이터 옮기기 (`dump.sh`, `restore.sh`, `copy-storage.mjs`)

**Files:**
- Create: `deploy/nuc7/migrate/dump.sh`, `deploy/nuc7/migrate/restore.sh`, `deploy/nuc7/migrate/reset.sql`, `deploy/nuc7/migrate/copy-storage.mjs`
- Test: `tests/self-host-storage.test.mjs`

**Interfaces:**
- Consumes: Task 2의 `counts.sql`, `verify-counts.mjs`. Task 1의 `parseEnv`. Task 3의 로컬 스택.
- Produces:
  - `dump.sh --linked|--local <dir>` 또는 `dump.sh --db-url <url> <dir>` → `<dir>/auth.sql`, `<dir>/app.sql`, `<dir>/counts.csv`, `<dir>/objects.csv`(bucket_id,name,owner,owner_id). 덤프 전후 행 수가 다르면 실패.
  - `TARGET_PSQL="<psql 명령>" restore.sh <dir> [--reset]` → 한 트랜잭션, 트리거 끔. 대상에 이미 행이 있으면 `--reset` 없이 실패.
  - `copy-storage.mjs --objects <csv> --source-url <url> --source-env <file> --target-url <url> --target-env <file> --owners-sql <out>` → 파일을 옮기고 owner를 맞추는 SQL을 쓴다.
  - 순수 함수: `parseCsv(text): string[][]`, `sqlLiteral(value: string|null): string`, `ownersSql(rows: string[][]): string`, `objectPath(bucket, name): string`.

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `tests/self-host-storage.test.mjs`

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { objectPath, ownersSql, parseCsv, sqlLiteral } from '../deploy/nuc7/migrate/copy-storage.mjs';

test('csv fields with commas, quotes and empty owners are read as written', () => {
  const text = 'bucket_id,name,owner,owner_id\nlearning-pdfs,"u1/a, b.pdf",11111111-1111-4111-8111-111111111111,u1\nlearning-audio,"u2/say ""hi"".webm",,\n';
  assert.deepEqual(parseCsv(text), [
    ['bucket_id', 'name', 'owner', 'owner_id'],
    ['learning-pdfs', 'u1/a, b.pdf', '11111111-1111-4111-8111-111111111111', 'u1'],
    ['learning-audio', 'u2/say "hi".webm', '', ''],
  ]);
});

test('owner SQL quotes every value and keeps a missing owner as null', () => {
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral(''), 'null');
  const sql = ownersSql([['learning-pdfs', "u1/it's.pdf", '11111111-1111-4111-8111-111111111111', 'u1']]);
  assert.equal(sql, "update storage.objects set owner = '11111111-1111-4111-8111-111111111111'::uuid, owner_id = 'u1' where bucket_id = 'learning-pdfs' and name = 'u1/it''s.pdf';\n");
});

test('object paths keep folder slashes and escape the rest', () => {
  assert.equal(objectPath('learning-pdfs', 'u1/a b#.pdf'), 'learning-pdfs/u1/a%20b%23.pdf');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `node --test tests/self-host-storage.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Storage 복사를 구현한다** — `deploy/nuc7/migrate/copy-storage.mjs`

```js
#!/usr/bin/env node
// Storage 파일을 원본에서 내려받아 대상에 같은 경로로 올린다. owner는 API로 올리면 비므로, 맞추는 SQL을 따로 쓴다.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from '../bin/init-env.mjs';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export const sqlLiteral = (value) => (value === '' || value == null ? 'null' : `'${value.replaceAll("'", "''")}'`);

export function ownersSql(rows) {
  return rows.map(([bucket, name, owner, ownerId]) =>
    `update storage.objects set owner = ${owner ? `${sqlLiteral(owner)}::uuid` : 'null'}, owner_id = ${sqlLiteral(ownerId)} where bucket_id = ${sqlLiteral(bucket)} and name = ${sqlLiteral(name)};\n`).join('');
}

export const objectPath = (bucket, name) => `${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;

async function main(argv) {
  const optional = (flag) => { const i = argv.indexOf(flag); return i < 0 ? undefined : argv[i + 1]; };
  const option = (flag) => { const value = optional(flag); if (value === undefined) throw new Error(`${flag}가 필요합니다.`); return value; };
  const rows = parseCsv(readFileSync(option('--objects'), 'utf8')).filter((row) => row.length === 4).slice(1);
  // 원본 env 파일에서 service 키의 이름: Vercel env는 SUPABASE_SERVICE_ROLE_KEY, `supabase status -o env`는 SERVICE_ROLE_KEY.
  const sourceKeyName = optional('--source-key-name') ?? 'SUPABASE_SERVICE_ROLE_KEY';
  const source = { url: option('--source-url').replace(/\/$/, ''), key: parseEnv(readFileSync(option('--source-env'), 'utf8')).get(sourceKeyName) };
  const target = { url: option('--target-url').replace(/\/$/, ''), key: parseEnv(readFileSync(option('--target-env'), 'utf8')).get('SERVICE_ROLE_KEY') };
  if (!source.key || !target.key) throw new Error('service 키를 env 파일에서 찾지 못했습니다.');
  const headers = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
  for (const [bucket, name] of rows) {
    const download = await fetch(`${source.url}/storage/v1/object/${objectPath(bucket, name)}`, { headers: headers(source.key) });
    if (!download.ok) throw new Error(`내려받기 실패 ${bucket}/${name}: ${download.status}`);
    const upload = await fetch(`${target.url}/storage/v1/object/${objectPath(bucket, name)}`, {
      method: 'POST',
      headers: { ...headers(target.key), 'Content-Type': download.headers.get('content-type') ?? 'application/octet-stream', 'x-upsert': 'true' },
      body: Buffer.from(await download.arrayBuffer()),
    });
    if (!upload.ok) throw new Error(`올리기 실패 ${bucket}/${name}: ${upload.status} ${await upload.text()}`);
    console.log(`옮김 ${bucket}/${name}`);
  }
  writeFileSync(option('--owners-sql'), ownersSql(rows));
  console.log(`${rows.length}개 파일을 옮겼습니다. owner는 ${option('--owners-sql')}로 맞춥니다.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
```
- [ ] **Step 4: 통과를 확인한다**

Run: `node --test tests/self-host-storage.test.mjs`
Expected: PASS (3 tests)

- [ ] **Step 5: 덤프 스크립트를 쓴다** — `deploy/nuc7/migrate/dump.sh`

```bash
#!/usr/bin/env bash
# 원본 Supabase에서 PaceOn이 지키는 데이터만 덤프한다: 앱 스키마 전부와 auth의 사용자·연결 정보.
# 세션과 토큰은 옛 JWT secret으로 서명되어 쓸 수 없으니 옮기지 않는다.
# 사용법: deploy/nuc7/migrate/dump.sh --linked <out-dir>
#         deploy/nuc7/migrate/dump.sh --local <out-dir>
#         deploy/nuc7/migrate/dump.sh --db-url <url> <out-dir>   (되돌릴 때 nuc7을 원본으로, ssh 터널)
set -euo pipefail
usage() { echo "사용법: dump.sh --linked|--local <out-dir> 또는 dump.sh --db-url <url> <out-dir>" >&2; exit 2; }
case "${1:-}" in
  --linked|--local) source=("$1"); out="${2:-}" ;;
  --db-url) source=(--db-url "${2:-}"); out="${3:-}" ;;
  *) usage ;;
esac
[ -n "$out" ] || usage
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$out"

counts() { supabase db query "${source[@]}" -o csv -f "$here/counts.sql"; }
counts > "$out/counts.csv"

exclude=$(supabase db query "${source[@]}" -o csv "select string_agg('auth.' || tablename, ',' order by tablename) as t from pg_tables where schemaname = 'auth' and tablename not in ('users', 'identities')" | tail -n 1 | tr -d '"\r')
[[ "$exclude" =~ ^auth\.[a-z_]+(,auth\.[a-z_]+)*$ ]] || { echo "auth 제외 목록을 읽지 못했습니다." >&2; exit 1; }

supabase db dump "${source[@]}" --data-only --use-copy -s auth -x "$exclude" -f "$out/auth.sql"
supabase db dump "${source[@]}" --data-only --use-copy -s public,private,learning_private -f "$out/app.sql"
supabase db query "${source[@]}" -o csv "select bucket_id, name, owner::text as owner, owner_id from storage.objects order by bucket_id, name" > "$out/objects.csv"

counts > "$out/counts.after.csv"
node "$here/verify-counts.mjs" "$out/counts.csv" "$out/counts.after.csv" >/dev/null \
  || { echo "덤프하는 동안 원본이 바뀌었습니다. 원본을 쓰는 것(Worker, 앱)을 멈추고 다시 덤프하세요." >&2; exit 1; }
grep -q 'COPY "auth"."users"\|COPY auth.users' "$out/auth.sql" || { echo "auth.sql에 사용자 행이 없습니다." >&2; exit 1; }
files=$(( $(grep -c . "$out/objects.csv" || true) - 1 )); [ "$files" -lt 0 ] && files=0
echo "덤프 완료: $out (테이블 $(( $(grep -c . "$out/counts.csv") - 1 ))개, Storage 파일 ${files}개)"
```

- [ ] **Step 6: 복원 스크립트를 쓴다** — `deploy/nuc7/migrate/reset.sql`과 `restore.sh`

`reset.sql`:

```sql
-- 리허설로 넣은 데이터를 비운다. restore.sh --reset만 쓴다. 전환 뒤에는 절대 쓰지 않는다.
do $$
declare app_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into app_tables
    from pg_tables
   where schemaname in ('public', 'private', 'learning_private');
  execute 'truncate ' || app_tables || ', auth.users, auth.identities, storage.objects restart identity cascade';
end $$;
```

`restore.sh`:

```bash
#!/usr/bin/env bash
# dump.sh의 결과를 대상 DB에 한 트랜잭션으로 넣는다. 트리거를 꺼서(replica) 옮기는 행이 바뀌지 않게 한다.
# 대상에 이미 행이 있으면 멈춘다. 리허설을 지우고 다시 넣을 때만 --reset을 준다.
# 사용법: TARGET_PSQL="<psql 명령>" deploy/nuc7/migrate/restore.sh <dump-dir> [--reset]
#   nuc7:  TARGET_PSQL="ssh nuc7 /opt/paceon/src/deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost"
set -euo pipefail
dir="${1:?덤프 폴더를 주세요}"; reset="${2:-}"
: "${TARGET_PSQL:?TARGET_PSQL을 정하세요}"
here="$(cd "$(dirname "$0")" && pwd)"
target() { $TARGET_PSQL -X -q -v ON_ERROR_STOP=1 "$@"; }

filled=$(target -At -f - < "$here/counts.sql" | awk -F, '$2 > 0' | wc -l)
if [ "$filled" -gt 0 ] && [ "$reset" != "--reset" ]; then
  echo "대상에 행이 있는 테이블이 ${filled}개 있습니다. 리허설 데이터를 지우고 다시 넣으려면 --reset을 주세요." >&2
  exit 1
fi
# 덤프 파일이 끝에서 세션 설정을 되돌릴 수 있으므로(RESET ALL 등) 파일마다 앞에 다시 끈다.
{
  echo "set session_replication_role = replica;"
  if [ "$reset" = "--reset" ]; then cat "$here/reset.sql"; fi
  cat "$dir/auth.sql"
  echo "set session_replication_role = replica;"
  cat "$dir/app.sql"
} | target -1 -f -
target -At -f - < "$here/counts.sql" > "$dir/counts.target.csv"
node "$here/verify-counts.mjs" "$dir/counts.csv" "$dir/counts.target.csv"
```
`storage.objects`는 `counts.csv`에 원본 행 수로 남고, 대상은 `copy-storage.mjs`를 돌린 뒤에야 같아진다. 그래서 파일이 있으면 위 마지막 비교에서 `storage.objects` 한 줄만 다르게 나오는 것이 정상이고, Step 8에서 다시 비교한다.

- [ ] **Step 7: 로컬에서 전체를 리허설한다** — 원본은 Supabase Local(CLI, 개발용), 대상은 Task 3의 로컬 운영 스택.
  1. Supabase Local에 데이터를 만든다(이 저장소에서 하던 방식: admin API로 사용자, `docker exec -i supabase_db_PaceOn psql -U postgres`로 행). 최소한 다음이 있어야 한다.
     - 사용자 2명(비밀번호 로그인 가능)
     - 읽기 전 책 1권(`reading_started_at` null), 재독 중인 책 1권, 진도 기록 몇 개
     - `learning-pdfs`에 사용자가 올린 작은 PDF 1개(Storage API, 사용자 토큰으로)
  2. 덤프: `deploy/nuc7/migrate/dump.sh --local .artifacts/move-local`
  3. 복원: `TARGET_PSQL="docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local exec -T db psql -U supabase_admin -h localhost" deploy/nuc7/migrate/restore.sh .artifacts/move-local`
     Expected: 앱 스키마와 auth는 모두 같고, `storage.objects` 한 줄만 `기준 1 / 대상 0`.
  4. 같은 명령을 한 번 더 실행한다. Expected: `대상에 행이 있는 테이블이 …개 있습니다` 로 멈추고 아무것도 바뀌지 않는다(Review Focus 3).
  5. `--reset`을 붙여 다시 실행한다. Expected: 같은 결과로 다시 들어간다.
  6. 읽기 전 책이 그대로 읽기 전인지 확인한다(`reading_started_at is null`). 트리거가 돌았다면 값이 채워진다(Review Focus 5). 내용 해시가 같으면 이것도 같다.
  7. Storage: `node deploy/nuc7/migrate/copy-storage.mjs --objects .artifacts/move-local/objects.csv --source-url http://127.0.0.1:55321 --source-env <(supabase status -o env) --source-key-name SERVICE_ROLE_KEY --target-url http://127.0.0.1:8000 --target-env deploy/nuc7/.env.local --owners-sql .artifacts/move-local/owners.sql` 후 `$TARGET_PSQL -f - < .artifacts/move-local/owners.sql`. (`<( )`가 안 되면 `supabase status -o env > .artifacts/local-status.env`로 파일을 만들고 끝나면 지운다.)
  8. 다시 비교한다: `$TARGET_PSQL -At -f - < deploy/nuc7/migrate/counts.sql > .artifacts/move-local/counts.target.csv && node deploy/nuc7/migrate/verify-counts.mjs .artifacts/move-local/counts.csv .artifacts/move-local/counts.target.csv`. Expected: 모두 같다.
  9. 브라우저(`http://localhost:13000`)에서 옮긴 사용자로 **원래 비밀번호로** 로그인하고, 서재·재독 상태·PDF 목록이 원본과 같은지 본다.
  10. 끝나면 `.artifacts/move-local`과 Supabase Local의 테스트 사용자를 지운다.
- 원본 Supabase Local의 포트(55321)는 `supabase status`로 확인한다.

- [ ] **Step 8: Commit**

```bash
git add deploy/nuc7/migrate tests/self-host-storage.test.mjs
git commit -m "feat: move PaceOn data between Supabase databases and check it arrived intact"
```

### Task 7: 서버 스크립트와 systemd (`bin/`, `host/`)

**Files:**
- Create: `deploy/nuc7/bin/compose`, `deploy/nuc7/bin/node`, `deploy/nuc7/bin/deploy.sh`, `deploy/nuc7/bin/backup.sh`, `deploy/nuc7/bin/restore-check.sh`
- Create: `deploy/nuc7/host/install-host.sh`, `paceon.slice`, `daemon.json`, `paceon-deploy.service`, `paceon-deploy.timer`, `paceon-backup.service`, `paceon-backup.timer`

**Interfaces:**
- Consumes: env 키 `PACEON_WORKER`, `PACEON_DATA`, `BACKUP_REMOTE`, `BACKUP_AGE_RECIPIENT`, `HC_DEPLOY_URL`, `HC_BACKUP_URL`. Task 2의 `counts.sql`, `verify-counts.mjs`.
- Produces:
  - `bin/compose …` = `docker compose`(프로젝트 폴더 `deploy/nuc7`, env `${PACEON_ENV:-/opt/paceon/.env}`, profile `tunnel`, `PACEON_WORKER=on`이면 `worker`도)
  - `bin/node <script> [args]` = `node:24.14.0-slim` 컨테이너에서 실행(`/opt/paceon` 마운트, 네트워크 `${NODE_NETWORK:-host}`)
  - `restore-check.sh [YYYY-MM-DD]` — 개발 PC, 설정 `~/.paceon/restore-check.env`(`BACKUP_REMOTE`, `AGE_IDENTITY`, `HC_RESTORE_URL`)

- [ ] **Step 1: 감싸개 두 개** — `deploy/nuc7/bin/compose`

```bash
#!/usr/bin/env bash
# nuc7 스택용 docker compose. env 파일과 profile을 붙인다. Worker는 PACEON_WORKER=on일 때만 들어간다.
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"
env_file="${PACEON_ENV:-/opt/paceon/.env}"
profiles=(--profile tunnel)
if [ "$(sed -n 's/^PACEON_WORKER=//p' "$env_file" | tail -n 1)" = "on" ]; then profiles+=(--profile worker); fi
exec docker compose --project-directory "$dir" -f "$dir/compose.yaml" --env-file "$env_file" "${profiles[@]}" "$@"
```

`deploy/nuc7/bin/node`:

```bash
#!/usr/bin/env bash
# nuc7에는 Node가 없다. 저장소의 Node 스크립트를 컨테이너에서 돌린다. 작업 폴더는 /opt/paceon/src.
set -euo pipefail
exec docker run --rm -i -u "$(id -u):$(id -g)" --network "${NODE_NETWORK:-host}" \
  -v /opt/paceon:/opt/paceon -w /opt/paceon/src node:24.14.0-slim node "$@"
```

- [ ] **Step 2: 배포 타이머 스크립트** — `deploy/nuc7/bin/deploy.sh`

```bash
#!/usr/bin/env bash
# 5분마다 새 main 이미지를 당겨 오고, 이미지가 바뀐 컨테이너만 다시 만든다. compose·Envoy 설정은 바꾸지 않는다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
services=(web)
if [ "${PACEON_WORKER:-off}" = "on" ]; then services+=(ai-worker); fi
"$here/compose" pull --quiet "${services[@]}"
"$here/compose" up -d --no-deps "${services[@]}"
docker image prune -f --filter "until=168h" >/dev/null
# 공개 주소로 Tunnel·Envoy·Auth까지 닿을 때만 신호를 보낸다. 신호가 끊기면 healthchecks.io가 메일을 보낸다.
curl -fsS -m 10 -H "apikey: ${ANON_KEY:?}" "${SUPABASE_PUBLIC_URL:?}/auth/v1/health" >/dev/null
if [ -n "${HC_DEPLOY_URL:-}" ]; then curl -fsS -m 10 --retry 3 "$HC_DEPLOY_URL" >/dev/null; fi
```

- [ ] **Step 3: 백업 스크립트** — `deploy/nuc7/bin/backup.sh`

```bash
#!/usr/bin/env bash
# 매일 DB 전체와 Storage 파일을 age로 암호화해 R2에 올린다. 복호화 키는 이 서버에 없다.
# 행 수 파일(counts.csv)은 암호화하지 않고 함께 올린다. 월간 복원 연습이 이것과 비교한다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${BACKUP_REMOTE:?}" "${BACKUP_AGE_RECIPIENT:?}" "${PACEON_DATA:?}"
day="$(TZ=Asia/Seoul date +%F)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

"$here/compose" exec -T db pg_dump -U supabase_admin -h localhost -Fc postgres > "$work/db.dump"
"$here/compose" exec -T db pg_restore --list < "$work/db.dump" > /dev/null
"$here/compose" exec -T db psql -U supabase_admin -h localhost -X -At -v ON_ERROR_STOP=1 -f - < "$here/../migrate/counts.sql" > "$work/counts.csv"
tar -C "$PACEON_DATA" -cf "$work/storage.tar" storage

age -r "$BACKUP_AGE_RECIPIENT" -o "$work/db.dump.age" "$work/db.dump"
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/storage.tar.age" "$work/storage.tar"
rm -f "$work/db.dump" "$work/storage.tar"

rclone copy "$work" "$BACKUP_REMOTE/daily/$day"
if [ "$(TZ=Asia/Seoul date +%d)" = "01" ]; then rclone copy "$work" "$BACKUP_REMOTE/monthly/$(TZ=Asia/Seoul date +%Y-%m)"; fi
if [ -n "${HC_BACKUP_URL:-}" ]; then curl -fsS -m 10 --retry 3 "$HC_BACKUP_URL" >/dev/null; fi
echo "백업 완료: $BACKUP_REMOTE/daily/$day"
```
`storage` 폴더를 읽으려면 `gnghkim`에게 권한이 있어야 한다. Task 11에서 확인한다.

- [ ] **Step 4: 월간 복원 연습** — `deploy/nuc7/bin/restore-check.sh` (개발 PC, Git Bash)

```bash
#!/usr/bin/env bash
# 개발 PC에서 최신(또는 지정한 날짜의) 백업을 내려받아 복호화하고, 운영과 같은 Postgres 이미지에 복원해 행 수와 내용을 비교한다.
# 설정: ~/.paceon/restore-check.env 에 BACKUP_REMOTE(읽기 전용 rclone 원격), AGE_IDENTITY(age 비밀키 파일), HC_RESTORE_URL.
set -euo pipefail
set -a; . "${RESTORE_CHECK_ENV:-$HOME/.paceon/restore-check.env}"; set +a
here="$(cd "$(dirname "$0")" && pwd)"
day="${1:-$(rclone lsf --dirs-only "$BACKUP_REMOTE/daily/" | sort | tail -n 1 | tr -d '/')}"
work="$(mktemp -d)"
name="paceon-restore-check"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

rclone copy "$BACKUP_REMOTE/daily/$day" "$work"
age -d -i "$AGE_IDENTITY" -o "$work/db.dump" "$work/db.dump.age"
docker run -d --name "$name" -e POSTGRES_PASSWORD=restore-check supabase/postgres:17.6.1.136 \
  postgres -c config_file=/etc/postgresql/postgresql.conf >/dev/null
for _ in $(seq 60); do docker exec "$name" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
# 이미지가 만든 Supabase 내부 객체와 겹치는 오류는 예상된다. 성공 여부는 마지막 비교가 정한다.
docker exec -i -e PGPASSWORD=restore-check "$name" pg_restore -U supabase_admin -h localhost --clean --if-exists -d postgres < "$work/db.dump" > "$work/restore.log" 2>&1 || true
docker exec -i -e PGPASSWORD=restore-check "$name" psql -U supabase_admin -h localhost -X -At -f - < "$here/../migrate/counts.sql" > "$work/restored.csv"
node "$here/../migrate/verify-counts.mjs" "$work/counts.csv" "$work/restored.csv"
if [ -n "${HC_RESTORE_URL:-}" ]; then curl -fsS -m 10 --retry 3 "$HC_RESTORE_URL" >/dev/null; fi
echo "복원 연습 통과: $day"
```

- [ ] **Step 5: root 설정 파일들** — `deploy/nuc7/host/`

`paceon.slice`:

```ini
[Unit]
Description=PaceOn containers (capped so ETFlow and the other services keep their share)
Before=slices.target

[Slice]
CPUQuota=150%
MemoryHigh=3G
MemoryMax=3584M
```

`daemon.json`:

```json
{
  "cgroup-parent": "paceon.slice",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
```

`paceon-deploy.service`:

```ini
[Unit]
Description=PaceOn: pull new main images
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=gnghkim
EnvironmentFile=/opt/paceon/.env
ExecStart=/opt/paceon/src/deploy/nuc7/bin/deploy.sh
Nice=10
```

`paceon-deploy.timer`:

```ini
[Unit]
Description=PaceOn: check for new images every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min
RandomizedDelaySec=30

[Install]
WantedBy=timers.target
```

`paceon-backup.service`:

```ini
[Unit]
Description=PaceOn: encrypted daily backup to R2
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=gnghkim
EnvironmentFile=/opt/paceon/.env
ExecStart=/opt/paceon/src/deploy/nuc7/bin/backup.sh
Nice=15
IOSchedulingClass=idle
```

`paceon-backup.timer`:

```ini
[Unit]
Description=PaceOn: daily backup at 07:00 KST (between the US close and the KRX open)

[Timer]
OnCalendar=*-*-* 07:00:00 Asia/Seoul
Persistent=true

[Install]
WantedBy=timers.target
```

`install-host.sh`:

```bash
#!/usr/bin/env bash
# nuc7 root 설정을 한 번 한다. 저장소를 받은 뒤 사용자가 직접 실행한다:
#   sudo /opt/paceon/src/deploy/nuc7/host/install-host.sh
# 타이머는 설치만 하고 켜지 않는다(PLAN.md Task 12·13에서 켠다). ufw와 다른 서비스는 건드리지 않는다.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
user="${SUDO_USER:?sudo로 실행하세요}"

apt-get update
apt-get install -y docker.io docker-compose-v2 age rclone

install -m 0644 "$here/paceon.slice" /etc/systemd/system/paceon.slice
install -d /etc/docker
if [ -e /etc/docker/daemon.json ] && ! cmp -s "$here/daemon.json" /etc/docker/daemon.json; then
  echo "/etc/docker/daemon.json이 이미 다릅니다. 직접 합친 뒤 다시 실행하세요." >&2
  exit 1
fi
install -m 0644 "$here/daemon.json" /etc/docker/daemon.json
for unit in paceon-deploy.service paceon-deploy.timer paceon-backup.service paceon-backup.timer; do
  install -m 0644 "$here/$unit" "/etc/systemd/system/$unit"
done
usermod -aG docker "$user"
install -d -o "$user" -g "$user" -m 0750 /opt/paceon/data
systemctl daemon-reload
systemctl enable --now docker
systemctl restart docker
echo "끝났습니다. $user는 다시 로그인해야 docker 그룹이 적용됩니다."
```

- [ ] **Step 6: 실행 권한과 문법 검사**

```bash
git add --chmod=+x deploy/nuc7/bin/compose deploy/nuc7/bin/node deploy/nuc7/bin/deploy.sh deploy/nuc7/bin/backup.sh deploy/nuc7/bin/restore-check.sh deploy/nuc7/host/install-host.sh deploy/nuc7/migrate/dump.sh deploy/nuc7/migrate/restore.sh deploy/nuc7/bin/init-env.mjs
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/mnt -w /mnt koalaman/shellcheck:stable deploy/nuc7/bin/compose deploy/nuc7/bin/node deploy/nuc7/bin/*.sh deploy/nuc7/host/install-host.sh deploy/nuc7/migrate/*.sh
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/mnt -w /mnt debian:trixie-slim sh -c 'apt-get -qq update >/dev/null && apt-get -qq install -y systemd >/dev/null && systemd-analyze verify deploy/nuc7/host/*.service deploy/nuc7/host/*.timer deploy/nuc7/host/*.slice 2>&1 | grep -v "Failed to prepare\|No such file\|executable path" || true'
```
Expected: shellcheck 경고 없음(있으면 고친다). `systemd-analyze`는 `/opt/paceon/...`가 없다는 경고만 낸다.

- [ ] **Step 7: Commit**

```bash
git add deploy/nuc7/bin deploy/nuc7/host
git commit -m "feat: add nuc7 deploy, backup and host setup scripts"
```

### Task 8: 문서와 PR 준비

**Files:**
- Modify: `docs/SELF_HOSTING.md` — 끝에 "## 운영 명령" 절을 넣는다.
- Modify: `docs/CHANGELOG.md` — 이 PR은 사용자 체감 변경이 없어 넣지 않는다(전환 때 Task 15에서 넣는다).

- [ ] **Step 1: 운영 명령 절을 쓴다** — `docs/SELF_HOSTING.md` 맨 끝에 덧붙인다. Task 3 Step 9에서 `supabase test db`가 `127.0.0.1`과 `host.docker.internal` 중 어느 주소로 됐는지 반영한다.

```markdown
## 운영 명령

nuc7에서는 `/opt/paceon/src/deploy/nuc7`에서 `bin/compose`를 쓴다. env 파일과 profile을 붙여 준다.

| 할 일 | 명령 |
| --- | --- |
| 상태 | `bin/compose ps` |
| 로그 | `bin/compose logs -f --tail 100 web` |
| 이미지 바로 갱신 | `sudo systemctl start paceon-deploy` |
| compose·Envoy 설정 반영 | `git -C /opt/paceon/src pull --ff-only && bin/compose up -d` |
| Studio 켜기·끄기 | `bin/compose --profile admin up -d studio` / `bin/compose --profile admin stop studio meta` |
| Studio 접속(개발 PC) | `ssh -N -L 3001:127.0.0.1:3001 nuc7` 후 `http://localhost:3001` (사용자 `paceon`, 비밀번호는 `.env`의 `DASHBOARD_PASSWORD`) |
| DB 접속(개발 PC) | `ssh -N -L 15432:127.0.0.1:5432 nuc7` 후 `postgresql://postgres:…@127.0.0.1:15432/postgres` |
| migration 올리기 | 위 터널을 열고 `supabase db push --db-url …` → `bin/compose restart rest` → PR 병합 |
| 특정 버전으로 되돌리기 | `.env`의 `PACEON_TAG=sha-<7자리>` 후 `bin/compose up -d web ai-worker`. 되돌린 뒤 다시 `main`으로 |
| 바로 백업 | `sudo systemctl start paceon-backup && journalctl -u paceon-backup -n 20` |
| 복원 연습(개발 PC, 매달) | `deploy/nuc7/bin/restore-check.sh` |
| 상태 확인 | `bin/node deploy/nuc7/smoke.mjs --env-file /opt/paceon/.env --api https://paceon-api.nolzza.net --web https://paceon.nolzza.net` |

anon·service_role 키는 만든 날로부터 10년 뒤 만료된다(만든 날: Task 11에서 적는다). 만료 전에 새 키로 바꾸고 GitHub 변수 `NUC7_ANON_KEY`도 바꾼다.

### 재해 복구

1. 새 서버(또는 디스크)에 Task 9를 다시 한다.
2. 비밀번호 관리자의 `/opt/paceon/.env` 사본과 age 비밀키를 꺼낸다.
3. R2에서 마지막 `daily/`를 받아 복호화한다.
4. `bin/compose up -d db`로 빈 DB를 띄우고 `pg_restore -U supabase_admin -h localhost --clean --if-exists -d postgres < db.dump`(컨테이너 안). Storage는 `storage.tar`를 `/opt/paceon/data`에 푼다.
5. `bin/compose up -d` 뒤 smoke와 `verify-counts.mjs`(백업의 `counts.csv` 기준)로 확인한다.
```

- [ ] **Step 2: 전체 검사**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: 모두 통과

- [ ] **Step 3: 로컬 스택을 정리한다**

```bash
docker compose -p paceon-local -f deploy/nuc7/compose.yaml -f deploy/nuc7/compose.local.yaml --env-file deploy/nuc7/.env.local down -v
rm deploy/nuc7/.env.local
git status --short
```
Expected: 남은 변경 없음(`.env.local`은 원래 무시되지만 비밀 값이 들었으니 지운다).

- [ ] **Step 4: Commit**

```bash
git add docs/SELF_HOSTING.md
git commit -m "docs: add nuc7 operating commands and disaster recovery"
```

---

## B. 서버와 외부 계정 작업

여기부터는 사용자와 함께 한다. 각 Task의 **사용자** 표시는 사용자가 직접 하는 조작이다. 비밀 값(SMTP 키, Tunnel 토큰, R2 키, age 비밀키)은 사용자가 직접 넣고, 에이전트는 값을 읽거나 출력하지 않는다.

### Task 9: nuc7 호스트 준비

- [ ] **Step 1: 브랜치를 push한다** — **사용자 승인 후** `git push -u origin feat/self-hosting` (nuc7이 이 브랜치를 받아야 한다. PR은 Task 12에서 연다.)
- [ ] **Step 2: 사용자** — nuc7에서 실행한다.

```bash
sudo install -d -o gnghkim -g gnghkim -m 0750 /opt/paceon
git clone --branch feat/self-hosting https://github.com/gnghkim/paceon /opt/paceon/src
sudo /opt/paceon/src/deploy/nuc7/host/install-host.sh
```
그다음 ssh를 끊고 다시 접속한다(docker 그룹 적용).

- [ ] **Step 3: 확인한다** (에이전트, `ssh nuc7`)

```bash
docker version --format '{{.Server.Version}}'; docker compose version
docker info --format '{{.CgroupDriver}} {{.CgroupVersion}}'
docker run --rm --name slice-check -d busybox sleep 30 && sleep 2 && systemctl status paceon.slice --no-pager | head -12; docker rm -f slice-check
systemctl is-active etflow ytvault bolt
age --version; rclone version | head -1
```
Expected: Docker 27 이상, compose v2, `systemd 2`, `paceon.slice` 아래에 `docker-<id>.scope`가 보인다, `active active active`. slice에 들어가지 않으면 `daemon.json`과 `docker info`의 cgroup driver를 확인한다.

### Task 10: 외부 계정 준비 (사용자, 대시보드)

에이전트는 각 단계의 정확한 화면 경로를 안내하고, 끝나면 확인 명령을 돌린다.

- [ ] **Step 1: Cloudflare에 nolzza.net 등록(Free)** — Cloudflare가 가져온 레코드를 후이즈 관리 화면의 레코드 전체와 대조한다. apex와 `www`(Vercel)는 회색 구름(DNS only).
- [ ] **Step 2: 대조 확인** (에이전트) — 네임서버를 바꾸기 전에 Cloudflare가 정한 네임서버(예: `xxx.ns.cloudflare.com`)에 직접 물어 본다.

```powershell
foreach ($n in 'nolzza.net','www.nolzza.net') { Resolve-DnsName $n -Server <cloudflare-ns> | Format-Table -HideTableHeaders }
```
Expected: 지금 후이즈의 답(apex `216.198.79.1`, `www` → `445edc974e3f72b5.vercel-dns-017.com`)과 같다. 후이즈에 다른 레코드(MX, TXT, 하위 주소)가 있었다면 그것도 하나씩 묻는다.
- [ ] **Step 3: 사용자** — 후이즈에서 네임서버를 Cloudflare 것으로 바꾼다. 반영(최대 24시간) 뒤 에이전트가 `Resolve-DnsName nolzza.net -Type NS -Server 1.1.1.1`과 `https://www.nolzza.net`이 그대로 뜨는지 확인한다.
- [ ] **Step 4: 사용자** — Cloudflare Zero Trust → Networks → Tunnels → `paceon` 만들기(cloudflared, Docker). 토큰을 nuc7 `/opt/paceon/.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣는다(Task 11 뒤). Published application routes를 이 순서로 넣는다.

| 순서 | Hostname | Path | Service |
| --- | --- | --- | --- |
| 1 | `paceon-api.nolzza.net` | `^/(auth\|rest\|storage)/v1/` | `http://api-gw:8000` |
| 2 | `paceon.nolzza.net` | (비움) | `http://web:3000` |
그 밖의 요청은 Tunnel의 기본 규칙(404)이 받는다.
- [ ] **Step 5: 사용자** — R2: 버킷 `paceon-backup`(위치 APAC). API 토큰 두 개: nuc7용 "Object Read & Write"(이 버킷만), 개발 PC용 "Object Read only"(이 버킷만). 수명 주기 규칙: 접두사 `daily/` 14일 뒤 삭제, `monthly/` 180일 뒤 삭제.
- [ ] **Step 6: 사용자** — Resend: 도메인 `nolzza.net` 추가 → 안내된 SPF·DKIM 레코드를 Cloudflare DNS에 넣고 인증 → SMTP용 API 키(Sending access, 이 도메인만).
- [ ] **Step 7: 사용자** — healthchecks.io: 체크 세 개. `paceon-backup`(주기 1일, 유예 2시간), `paceon-deploy`(주기 5분, 유예 30분), `paceon-restore-check`(주기 35일, 유예 1일). 알림은 gnghkim@gmail.com.
- [ ] **Step 8: 사용자** — 개발 PC에서 age 키를 만든다: `age-keygen -o %USERPROFILE%\.paceon\backup.agekey`(`winget install FiloSottile.age`로 설치). 비밀키 파일 내용은 비밀번호 관리자에도 넣는다. 공개키(`age1…`) 한 줄을 에이전트에게 알려 준다(공개해도 되는 값).

### Task 11: nuc7에 빈 스택 띄우기

- [ ] **Step 1: 운영 값 가져오기** (에이전트, 값은 출력하지 않는다)

```bash
# 개발 PC, 저장소 루트에서. S는 이 세션의 scratchpad
vercel env pull --environment=production "$S/vercel.env" --yes
scp -i ~/.ssh/linkvault_hostinger root@187.127.204.154:/opt/paceon-deploy/.env "$S/vps.env"
ssh nuc7 'install -d -m 0700 /opt/paceon/import'
scp "$S/vercel.env" "$S/vps.env" nuc7:/opt/paceon/import/
rm "$S/vercel.env" "$S/vps.env"
ssh nuc7 'cd /opt/paceon/src && deploy/nuc7/bin/node deploy/nuc7/bin/init-env.mjs /opt/paceon/.env --import /opt/paceon/import/vercel.env --import /opt/paceon/import/vps.env; rm -rf /opt/paceon/import; ls -l /opt/paceon/.env'
```
Expected: `-rw------- … /opt/paceon/.env`, 그리고 "직접 채울 값" 목록. 목록에 `GOOGLE_CLIENT_SECRET`처럼 운영에서 와야 할 값이 있으면 Vercel에서 민감 값(Sensitive)이라 내려받지 못한 것이다. 사용자에게 알리고 원래 콘솔에서 직접 넣게 한다.
- [ ] **Step 2: 사용자** — `/opt/paceon/.env`를 열어 `SMTP_PASS`(Resend 키), `CLOUDFLARE_TUNNEL_TOKEN`, `HC_DEPLOY_URL`, `HC_BACKUP_URL`을 채운다. `BACKUP_AGE_RECIPIENT`는 에이전트가 Task 10의 공개키로 채운다. 파일 사본을 비밀번호 관리자에 넣는다(재해 복구용).
- [ ] **Step 3: 사용자** — rclone 원격을 만든다: `rclone config create r2 s3 provider=Cloudflare access_key_id=<…> secret_access_key=<…> endpoint=https://<account-id>.r2.cloudflarestorage.com no_check_bucket=true` (nuc7, 읽기·쓰기 토큰).
- [ ] **Step 4: Supabase 부분을 띄운다** (에이전트)

```bash
ssh nuc7 'cd /opt/paceon/src/deploy/nuc7 && bin/compose up -d db auth rest storage api-gw cloudflared && sleep 60 && bin/compose ps'
```
Expected: 6개 `healthy`/`running`. `bin/compose logs cloudflared`에 `Registered tunnel connection` 4줄.
- [ ] **Step 5: migration과 pgTAP** (에이전트, 개발 PC Git Bash)

```bash
ssh -f -N -L 15432:127.0.0.1:5432 nuc7
url="postgresql://postgres:$(ssh nuc7 "sed -n 's/^POSTGRES_PASSWORD=//p' /opt/paceon/.env")@127.0.0.1:15432/postgres?sslmode=disable"
supabase db push --db-url "$url" --yes
supabase test db --db-url "$url"
unset url
ssh nuc7 'cd /opt/paceon/src/deploy/nuc7 && bin/compose restart rest && bin/compose exec -T db psql -U postgres -h localhost -Atc "show timezone"'
```
Expected: migration 전부, pgTAP 통과, `UTC`. (`supabase test db`의 주소는 Task 3 Step 9에서 된 쪽을 쓴다.)
- [ ] **Step 6: smoke** — 안쪽과 Tunnel 너머 둘 다.

```bash
ssh nuc7 'cd /opt/paceon/src && NODE_NETWORK=paceon_default deploy/nuc7/bin/node deploy/nuc7/smoke.mjs --env-file /opt/paceon/.env --api http://api-gw:8000 --login'
ssh nuc7 'cd /opt/paceon/src && deploy/nuc7/bin/node deploy/nuc7/smoke.mjs --env-file /opt/paceon/.env --api https://paceon-api.nolzza.net --login'
curl -s -o /dev/null -w '%{http_code}\n' https://paceon-api.nolzza.net/pg/tables
curl -s -o /dev/null -w '%{http_code}\n' https://paceon-api.nolzza.net/
```
Expected: 두 번 다 `7개 모두 통과`. 마지막 두 줄은 `404`(Tunnel 경로 규칙).
- [ ] **Step 7: 자원과 이웃 서비스 확인**

```bash
ssh nuc7 'systemctl status paceon.slice --no-pager | sed -n "1,8p"; free -h | head -2; uptime; systemctl is-active etflow ytvault bolt'
```
Expected: slice 메모리 1.5GB 안팎, `active active active`. `docs/SELF_HOSTING.md`의 운영 명령 절에 키를 만든 날짜(오늘)를 적는다.

### Task 12: 이미지와 배포 타이머

- [ ] **Step 1: GitHub 변수** (에이전트, 사용자 승인 후) — 공개 값만 넣는다.

```bash
gh variable set NUC7_SUPABASE_URL --body https://paceon-api.nolzza.net
ssh nuc7 "sed -n 's/^ANON_KEY=//p' /opt/paceon/.env" | gh variable set NUC7_ANON_KEY
ssh nuc7 "sed -n 's/^VAPID_PUBLIC_KEY=//p' /opt/paceon/.env" | gh variable set NUC7_VAPID_PUBLIC_KEY
gh variable list
```
- [ ] **Step 2: PR을 연다** (사용자 승인 후) — 제목 `feat: move PaceOn to the self-hosted nuc7 server (stack, images, scripts)`. 본문에 "이 PR은 운영 동작을 바꾸지 않는다(Vercel 빌드에 standalone 출력만 더해진다)"를 적는다. Expected: CI와 `Images` 워크플로 두 job 모두 통과.
- [ ] **Step 3: 병합** (사용자 승인 후) → `Images`가 GHCR에 올렸는지 확인한다.

```bash
gh run list --workflow Images --limit 2
ssh nuc7 'docker logout ghcr.io >/dev/null 2>&1; docker pull ghcr.io/gnghkim/paceon-web:main && docker pull ghcr.io/gnghkim/paceon-ai-worker:main'
```
Expected: 로그인 없이 받아진다. `denied`가 나오면 **사용자**가 GitHub → Packages → 두 패키지 → Package settings → Change visibility → Public.
- [ ] **Step 4: nuc7 저장소를 main으로 돌리고 웹을 띄운다**

```bash
ssh nuc7 'cd /opt/paceon/src && git fetch && git checkout main && git pull --ff-only && cd deploy/nuc7 && bin/compose up -d web && sleep 30 && bin/compose ps web'
ssh nuc7 'cd /opt/paceon/src && deploy/nuc7/bin/node deploy/nuc7/smoke.mjs --env-file /opt/paceon/.env --api https://paceon-api.nolzza.net --web https://paceon.nolzza.net --login'
```
Expected: `10개 모두 통과`.
- [ ] **Step 5: 배포 타이머를 켠다** — **사용자**: `sudo systemctl enable --now paceon-deploy.timer`. 에이전트가 `systemctl list-timers paceon-deploy.timer`와 healthchecks.io `paceon-deploy` 신호를 확인한다.
- [ ] **Step 6: 사용자** — 휴대폰과 PC 브라우저로 `https://paceon.nolzza.net/login`의 가입에서 테스트 가입을 해 본다(본인의 다른 메일 주소). 확인 메일이 Resend로 오는지, 링크가 `paceon-api.nolzza.net/auth/v1/verify…`로 가서 로그인되는지 본다. 끝나면 에이전트가 admin API로 그 계정을 지운다.

### Task 13: 리허설

Cloud는 그대로 운영 중이다. nuc7 Worker는 꺼져 있다(`PACEON_WORKER=off`).

- [ ] **Step 1: 덤프** (개발 PC, scratchpad) — `deploy/nuc7/migrate/dump.sh --linked <scratch>/rehearsal`. 덤프 중 원본이 바뀌었다고 멈추면(VPS Worker가 쓰는 테이블) 한 번 더 한다. 계속 바뀌면 바뀐 테이블을 적고 리허설에서는 그 차이를 허용한다.
- [ ] **Step 2: 복원** — `TARGET_PSQL="ssh nuc7 /opt/paceon/src/deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost" deploy/nuc7/migrate/restore.sh <scratch>/rehearsal`. Expected: 모두 같다(Storage 파일이 있으면 `storage.objects`만 다르다).
- [ ] **Step 3: Storage** — `objects.csv`에 파일이 있을 때만. 대상 키가 nuc7 밖으로 나가지 않게 nuc7에서 돌린다. 원본 키 파일은 잠깐 nuc7에 올렸다가 지운다.

```bash
S=<scratchpad>
vercel env pull --environment=production "$S/vercel.env" --yes   # 저장소 루트에서
ssh nuc7 'install -d -m 0700 /opt/paceon/import'
scp "$S/vercel.env" "$S/rehearsal/objects.csv" nuc7:/opt/paceon/import/
rm "$S/vercel.env"
ssh nuc7 'cd /opt/paceon/src && deploy/nuc7/bin/node deploy/nuc7/migrate/copy-storage.mjs \
    --objects /opt/paceon/import/objects.csv \
    --source-url https://nxlekljxuojobokngvnr.supabase.co --source-env /opt/paceon/import/vercel.env \
    --target-url https://paceon-api.nolzza.net --target-env /opt/paceon/.env \
    --owners-sql /opt/paceon/import/owners.sql \
  && deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost -v ON_ERROR_STOP=1 -f - < /opt/paceon/import/owners.sql; \
  rm -rf /opt/paceon/import'
ssh nuc7 '/opt/paceon/src/deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost -X -At -f -' < deploy/nuc7/migrate/counts.sql > "$S/rehearsal/counts.target.csv"
node deploy/nuc7/migrate/verify-counts.mjs "$S/rehearsal/counts.csv" "$S/rehearsal/counts.target.csv"
```
Expected: 모두 같다.
- [ ] **Step 4: 사용자** — `https://paceon.nolzza.net`에 원래 계정·비밀번호로 로그인해 오늘·서재·통계·완독 기록이 Cloud와 같은지 본다. **기록을 남기지 않는다**(리허설 데이터는 전환 때 지워진다).
- [ ] **Step 5: 백업과 복원 연습**

```bash
ssh nuc7 'cd /opt/paceon/src/deploy/nuc7 && set -a && . /opt/paceon/.env && set +a && bin/backup.sh'
rclone lsf r2ro:paceon-backup/daily/   # 개발 PC, 읽기 전용 원격
deploy/nuc7/bin/restore-check.sh
```
`~/.paceon/restore-check.env`(개발 PC): `BACKUP_REMOTE=r2ro:paceon-backup`, `AGE_IDENTITY=$HOME/.paceon/backup.agekey`, `HC_RESTORE_URL=<healthchecks 주소>`. **사용자**가 `rclone config create r2ro s3 …`(읽기 전용 토큰)을 PC에서 만든다(`winget install Rclone.Rclone`).
Expected: `백업 완료`, R2에 `db.dump.age`, `storage.tar.age`, `counts.csv`, `복원 연습 통과`. `tar`가 `storage` 권한 오류를 내면 `ls -ln /opt/paceon/data/storage`로 소유자를 보고, **사용자**가 `sudo setfacl -R -m u:gnghkim:rX -m d:u:gnghkim:rX /opt/paceon/data/storage`로 읽기 권한을 준다.
- [ ] **Step 6: 사용자** — `sudo systemctl enable --now paceon-backup.timer`. 다음 날 07:00 뒤 healthchecks.io `paceon-backup` 신호를 확인한다.

### Task 14: 전환

**사용자에게 날짜·시각을 정해 승인받는다.** 약 30분. 그동안 PaceOn을 쓰지 않는다.

- [ ] **Step 1: 사전 점검** — Cloud에 진행 중인 작업이 없는지 본다: `supabase db query --linked "select status, count(*) from public.ai_jobs group by 1"`과 PDF·음성 작업 테이블. `RUNNING`이 있으면 끝날 때까지 기다린다.
- [ ] **Step 2: VPS Worker를 멈춘다**

```bash
ssh -i ~/.ssh/linkvault_hostinger root@187.127.204.154 'cd /opt/paceon-deploy && docker compose stop && docker compose ps'
```
Expected: `paceon-ai-worker` `Exited`. (텔레그램 폴링도 멈춘다.)
- [ ] **Step 3: 최종 덤프와 복원** — Task 13 Step 1~3을 `--reset`으로 다시 한다.

```bash
deploy/nuc7/migrate/dump.sh --linked <scratch>/cutover
TARGET_PSQL="ssh nuc7 /opt/paceon/src/deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost" deploy/nuc7/migrate/restore.sh <scratch>/cutover --reset
```
Expected: 모두 같다(Storage는 copy-storage 뒤 다시 비교해서 같다).
- [ ] **Step 4: 옛 푸시 구독을 지운다** — 출처가 바뀌어 옛 주소의 구독은 새 주소에서 쓸 수 없다.

```bash
ssh nuc7 '/opt/paceon/src/deploy/nuc7/bin/compose exec -T db psql -U supabase_admin -h localhost -c "delete from public.push_subscriptions"'
```
- [ ] **Step 5: nuc7 Worker를 켠다** — `/opt/paceon/.env`에서 `PACEON_WORKER=on`, `TELEGRAM_ENABLED=true`로 바꾸고(에이전트가 `sed -i`로, 값 두 개만):

```bash
ssh nuc7 "sed -i 's/^PACEON_WORKER=.*/PACEON_WORKER=on/; s/^TELEGRAM_ENABLED=.*/TELEGRAM_ENABLED=true/' /opt/paceon/.env && cd /opt/paceon/src/deploy/nuc7 && bin/compose up -d ai-worker && sleep 20 && bin/compose ps ai-worker && bin/compose logs --tail 30 ai-worker"
```
Expected: `healthy`, 로그에 소비자 스레드가 모두 시작됐다는 줄(텔레그램 포함).
- [ ] **Step 6: Google OAuth** — **사용자**: Google Cloud 콘솔 → 사용자 인증 정보 → 해당 OAuth 클라이언트 → 승인된 리디렉션 URI에 `https://paceon.nolzza.net/api/youtube/callback` 추가(옛 주소는 2주 뒤 정리 때 뺀다).
- [ ] **Step 7: 옛 주소 리디렉트** (사용자 승인 후) — 새 브랜치 `chore/vercel-redirect`에 `apps/web/vercel.json`:

```json
{
  "redirects": [
    { "source": "/(.*)", "destination": "https://paceon.nolzza.net/$1", "permanent": false }
  ]
}
```
PR → 병합. Vercel이 빌드한 뒤 `curl -sI https://paceon-green.vercel.app/today`가 `307`과 `location: https://paceon.nolzza.net/today`를 준다. `vercel.json`은 Vercel만 읽는다. nuc7의 Next 서버는 이 파일을 무시한다.
- [ ] **Step 8: 확인 목록** — 사용자와 함께 하나씩.
  - [ ] 원래 계정으로 로그인(PC, 휴대폰)
  - [ ] 독서 기록 하나 남기기, 오늘 화면 갱신
  - [ ] PDF 올리기 → 가져오기 완료(Worker)
  - [ ] 영어 학습: 음성 녹음 → 재생(Storage) → AI 피드백
  - [ ] 설정에서 푸시 알림 다시 켜기 → 테스트 알림 도착(두 기기)
  - [ ] 텔레그램 봇에 말 걸기 → 한 번만 답함
  - [ ] YouTube 연결 상태 유지(연결이 풀렸으면 다시 연결)
  - [ ] 다음 날 아침 매일 알림이 한 번 도착
  - [ ] `smoke.mjs --login` 10개 통과
- [ ] **Step 9: 사용자** — UptimeRobot(무료): `https://paceon.nolzza.net/api/health`, 키워드 `ok`, 5분, 알림 gnghkim@gmail.com. API는 apikey 헤더가 있어야 답하는데 무료 플랜은 헤더를 못 넣는다. 그래서 API는 배포 타이머가 5분마다 공개 주소로 확인하고(`deploy.sh`), 실패하면 healthchecks.io `paceon-deploy` 신호가 끊겨 메일이 온다.

### 되돌리기 (전환 뒤 2주 안, 사용자 결정)

1. nuc7 Worker를 끈다: `.env`에서 `PACEON_WORKER=off`, `TELEGRAM_ENABLED=false` 후 `bin/compose stop ai-worker`.
2. 전환 뒤 nuc7에 쌓인 기록을 살린다면: Supabase Cloud를 대시보드에서 다시 켜고(일시 정지됐을 때), ssh 터널을 연 채 `dump.sh --db-url postgresql://postgres:…@127.0.0.1:15432/postgres?sslmode=disable <dir>`로 nuc7을 덤프해 Cloud에 `restore.sh <dir> --reset`으로 넣는다. 이때 `TARGET_PSQL`은 `docker run --rm -i supabase/postgres:17.6.1.136 psql "<Cloud 직접 연결 문자열>"`이다(Cloud 대시보드 → Connect에서 받는다). Cloud의 `postgres` 역할은 `auth.users`를 비우지 못할 수 있다. 먼저 `truncate auth.identities`를 트랜잭션 안에서 시험하고, 안 되면 nuc7에서 전환 뒤 생긴 행만 고르는 SQL을 따로 쓴다.
3. VPS Worker를 켠다: `cd /opt/paceon-deploy && docker compose up -d`.
4. `apps/web/vercel.json`을 지우는 PR을 병합한다.
5. 푸시 알림은 옛 주소에서 다시 켠다.

### Task 15: 문서와 기록 마무리

- [ ] **Step 1:** `docs/SELF_HOSTING.md` 상태 줄을 `운영 중 (2026-MM-DD 전환)`으로, 리허설·전환에서 정한 것(겹친 테이블, 걸린 시간, 실제 명령 차이)을 반영한다.
- [ ] **Step 2:** `docs/ARCHITECTURE.md`의 배포 설명(Vercel·Supabase Cloud·VPS)을 nuc7 구성으로 바꾸고 SELF_HOSTING.md로 연결한다.
- [ ] **Step 3:** `docs/CHANGELOG.md`에 `### Changed - 웹·DB·Worker를 자체 서버(nuc7)로 옮김. 주소는 https://paceon.nolzza.net (#PR)`.
- [ ] **Step 4:** `README.md`의 배포·운영 주소가 있으면 새 주소로.
- [ ] **Step 5:** `docs/` 변경을 PR로(사용자 승인 후) 병합.
- [ ] **Step 6:** 에이전트 메모리 `paceon-production-deploy.md`를 nuc7 기준으로 고친다(배포 순서, `bin/compose`, Tunnel, R2, 옛 VPS·Vercel은 정리 대기).
- [ ] **Step 7:** Notion 프로젝트 페이지·개발 로그(L2), 이전 결정은 Decision Log(L3). 실패하면 `.doc-manager/notion-pending.md`에 남기고 "Notion 업데이트 미완료"로 알린다.

### Task 16: 2주 뒤 정리 (사용자 승인 후, 별도 진행)

- [ ] Supabase Cloud `paceon` 프로젝트 삭제(먼저 마지막 덤프를 `dump.sh --linked`로 받아 age로 암호화해 R2 `archive/`에 둔다).
- [ ] Vercel `paceon` 프로젝트 Git 연결 끊기. 3개월 뒤 프로젝트 삭제(리디렉트 종료).
- [ ] VPS: `cd /opt/paceon-deploy && docker compose down`, `docker image rm paceon-ai-worker:*`, `rm -rf /opt/paceon /opt/paceon-deploy`. linkvault는 건드리지 않는다.
- [ ] Google OAuth 리디렉션 URI에서 옛 Vercel 주소를 뺀다.
- [ ] 메모리와 SELF_HOSTING.md에서 "정리 대기"를 지운다.
