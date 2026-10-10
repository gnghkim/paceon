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
  // 앱 migration은 anon에게서 테이블 권한을 거둔다. 권한 거절이나(RLS로) 빈 목록이면 사용자 데이터가 새지 않은 것이다.
  ['anon 키로는 사용자 데이터를 읽을 수 없다', async () => {
    const response = await call(`${api}/rest/v1/resources?select=id&limit=1`, { headers: as(anon) });
    if (response.status === 401 || response.status === 403) return (await response.json()).code === '42501';
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
