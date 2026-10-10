import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookApiConfig } from '../apps/web/src/lib/books-api.ts';
import { readYouTubeConfig } from '../apps/web/src/lib/youtube-oauth.ts';

// 자체 서버에서는 웹 서버가 Supabase를 같은 내부망 주소로 부른다. 공개 주소로 부르면 Cloudflare 해외 엣지를 돌아온다.
function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  try { return run(); } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
}

test('server API calls use the internal Supabase address when it is set', () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://paceon-api.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon', SUPABASE_INTERNAL_URL: 'http://api-gw:8000' }, () => {
    assert.deepEqual(bookApiConfig(), { url: 'http://api-gw:8000', key: 'anon' });
  });
});

test('without an internal address the public one is used, as on Vercel', () => {
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://paceon-api.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon', SUPABASE_INTERNAL_URL: undefined }, () => {
    assert.deepEqual(bookApiConfig(), { url: 'https://paceon-api.example', key: 'anon' });
  });
});

test('the YouTube connection also talks to Supabase on the internal address', () => {
  const env = {
    GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', YOUTUBE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    APP_URL: 'https://paceon.example', NEXT_PUBLIC_SUPABASE_URL: 'https://paceon-api.example', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service', SUPABASE_INTERNAL_URL: 'http://api-gw:8000',
  };
  assert.equal(readYouTubeConfig(env)?.supabaseUrl, 'http://api-gw:8000');
  assert.equal(readYouTubeConfig({ ...env, SUPABASE_INTERNAL_URL: undefined })?.supabaseUrl, 'https://paceon-api.example');
});
