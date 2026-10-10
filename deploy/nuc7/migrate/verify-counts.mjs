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
