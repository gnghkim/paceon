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
