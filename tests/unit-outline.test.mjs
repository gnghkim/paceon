import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generateOutline,
  parseDuration,
  parseOutline,
  suggestDefaultMinutes,
  summarizeOutline,
} from '../apps/web/src/lib/unit-outline.ts';

test('a textbook is laid out from a name and a count', () => {
  const units = generateOutline('Unit', 115);
  assert.equal(units.length, 115);
  assert.equal(units[0].title, 'Unit 1');
  assert.equal(units.at(-1).title, 'Unit 115');
  assert.ok(units.every((unit) => unit.minutes === undefined && !unit.section));
});

test('a Korean counter goes after the number, the way it is said', () => {
  assert.deepEqual(generateOutline('강', 3).map((u) => u.title), ['1강', '2강', '3강']);
  assert.deepEqual(generateOutline('회차', 2).map((u) => u.title), ['1회차', '2회차']);
  assert.deepEqual(generateOutline('Lesson', 2, 10).map((u) => u.title), ['Lesson 10', 'Lesson 11']);
});

test('an impossible count produces nothing rather than a broken outline', () => {
  for (const [label, count] of [['Unit', 0], ['Unit', -1], ['Unit', 2001], ['Unit', 1.5], ['', 10], ['   ', 10]])
    assert.deepEqual(generateOutline(label, count), [], `${label} × ${count}`);
});

test('lengths are read as minutes and always rounded up', () => {
  assert.equal(parseDuration('20:15'), 21);
  assert.equal(parseDuration('02:36'), 3, 'a lecture of two and a half minutes still takes a slot');
  assert.equal(parseDuration('00:20'), 1, 'nothing is ever zero minutes');
  assert.equal(parseDuration('1:57:00'), 117);
  assert.equal(parseDuration('12분'), 12);
  assert.equal(parseDuration('1시간 14분'), 74);
  assert.equal(parseDuration('∙ (7시간 16분)'), 436);
  assert.equal(parseDuration('(22분)'), 22);
  assert.equal(parseDuration('30초'), 1);
});

test('text that only looks like a length is not one', () => {
  for (const text of ['', '제목', '2개', '12', '1:2', '25:61', 'Unit 12', '3.5'])
    assert.equal(parseDuration(text), null, JSON.stringify(text));
});

// 강의 사이트의 커리큘럼을 복사하면 이런 모양으로 온다. 번호, 제목, 길이가 줄마다 흩어지고
// 사이사이에 잡음이 낀다. 내용은 지어낸 것이고 모양만 실제와 같다.
const copied = `커리큘럼
전체
9개
∙ (3시간 2분)
해당 강의에서 제공:
수업자료
모두 펼치기
섹션 1. 시작하기
2개
∙ (23분)
1.
강의 소개와 목표
미리보기
20:15
2.
수업 자료 받는 법
02:36
섹션 2. 곧 열릴 수업
2개
3.
요청을 받습니다
4.
... 추가 공개 예정
섹션 3. 기초 다지기
3개
∙ (51분)
5.
첫 번째 실습(준비물 포함)
15:05
6.
두 번째 실습
27:57
7.
세 번째 실습
08:35
섹션 4. 심화
7개
∙ (1시간 14분)
섹션 5. 라이브
1개
∙ (1시간 57분)`;

test('a copied course page becomes sections, lectures and their lengths', () => {
  const items = parseOutline(copied);
  assert.deepEqual(items.slice(0, 3), [
    { title: '시작하기', section: true },
    { title: '강의 소개와 목표', minutes: 21 },
    { title: '수업 자료 받는 법', minutes: 3 },
  ]);
  assert.equal(items.find((item) => item.title === '커리큘럼'), undefined, 'the page heading is not a lecture');
  assert.equal(items.some((item) => /미리보기|모두 펼치기|수업자료/.test(item.title)), false, 'page furniture is dropped');
});

test('the total under a section heading is not mistaken for a lecture length', () => {
  const items = parseOutline(copied);
  const intro = items.find((item) => item.title === '강의 소개와 목표');
  assert.equal(intro.minutes, 21, 'not the section total of 23');
  const first = items.find((item) => item.title === '첫 번째 실습(준비물 포함)');
  assert.equal(first.minutes, 16, 'a title ending in a bracket keeps its own length');
});

test('a lecture with no length yet is kept without one', () => {
  const items = parseOutline(copied);
  const pending = items.filter((item) => !item.section && item.minutes === undefined).map((item) => item.title);
  assert.deepEqual(pending, ['요청을 받습니다', '... 추가 공개 예정']);
});

test('a section copied while folded survives as one chapter with its total', () => {
  const items = parseOutline(copied);
  assert.deepEqual(items.slice(-2), [
    { title: '심화', minutes: 74 },
    { title: '라이브', minutes: 117 },
  ]);
});

test('a plain one-per-line list works too, with or without lengths', () => {
  assert.deepEqual(parseOutline('1강 OT 12:30\n2강 설치 (8분)\n3강 첫 프로그램 - 1:02:03\n4강 정리'), [
    { title: '1강 OT', minutes: 13 },
    { title: '2강 설치', minutes: 8 },
    { title: '3강 첫 프로그램', minutes: 63 },
    { title: '4강 정리' },
  ]);
  assert.deepEqual(parseOutline('1. am/is/are\n2. questions\n\n3) doing').map((i) => i.title), ['am/is/are', 'questions', 'doing']);
});

test('headings with nothing under them and no total are dropped', () => {
  assert.deepEqual(parseOutline('Part 1 Present\nUnit 1\nUnit 2\nPart 2 Past\nPart 3 Future'), [
    { title: 'Present', section: true },
    { title: 'Unit 1' },
    { title: 'Unit 2' },
  ]);
});

test('empty or meaningless text gives an empty outline', () => {
  for (const text of ['', '   \n\n ', '미리보기\n2개\n12:30']) assert.deepEqual(parseOutline(text), [], JSON.stringify(text));
});

test('the summary counts what will be scheduled and what is unknown', () => {
  assert.deepEqual(summarizeOutline(parseOutline(copied)), { units: 9, sections: 3, knownMinutes: 268, untimed: 2 });
});

test('the default length is the median, so one two-hour live does not drag it', () => {
  // 3, 9, 16, 21, 28, 74, 117
  assert.equal(suggestDefaultMinutes(parseOutline(copied)), 21);
  assert.equal(suggestDefaultMinutes([{ title: 'a', minutes: 10 }, { title: 'b', minutes: 20 }]), 15);
  assert.equal(suggestDefaultMinutes(generateOutline('Unit', 5)), null, 'nothing known, nothing to suggest');
});
