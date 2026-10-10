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
  'YES24_API_KEY', 'GOOGLE_BOOKS_API_KEY',
];
const OPTIONAL = new Set(['OPENAI_TRANSCRIBE_MODEL', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_VOICE', 'AI_POLL_SECONDS', 'NOTIFY_POLL_SECONDS', 'TELEGRAM_DAILY_TURN_LIMIT', 'YES24_API_KEY', 'GOOGLE_BOOKS_API_KEY']);

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
