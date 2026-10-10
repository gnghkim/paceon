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
