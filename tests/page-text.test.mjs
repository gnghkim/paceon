import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_TEXT, decodeBody, decodeEntities, extractPage, focusOnOutline } from '../apps/web/src/lib/page-text.ts';
import { parseOutline } from '../apps/web/src/lib/unit-outline.ts';

test('only what a person would read survives', () => {
  const page = extractPage(`<html><head><title>  강의 &amp; 실습  </title>
    <meta property="og:description" content="업무를 &quot;자동화&quot;합니다">
    <style>.x{color:red}</style><script>window.secret = "1강 가짜 12:30";</script></head>
    <body><!-- 주석 속 2강 --><noscript>켜 주세요</noscript>
    <h2>커리큘럼</h2><ul><li><span>1.</span><span>강의 소개</span><span>20:15</span></li></ul>
    <svg><text>그림 속 글</text></svg></body></html>`);
  assert.equal(page.title, '강의 & 실습');
  assert.equal(page.description, '업무를 "자동화"합니다');
  assert.deepEqual(page.text.split('\n'), ['커리큘럼', '1.', '강의 소개', '20:15']);
});

test('the social title is preferred, and either quote style is read', () => {
  const page = extractPage(`<head><meta content='진짜 제목' property='og:title'><title>탭 제목 | 사이트</title></head><body>글</body>`);
  assert.equal(page.title, '진짜 제목');
});

test('what comes out of a page reads straight into the outline parser', () => {
  const page = extractPage(`<body><h2>커리큘럼</h2>
    <div>섹션 1. 시작하기</div><div>2개</div><div>∙ (23분)</div>
    <div><b>1.</b><a>강의 소개</a><i>미리보기</i><em>20:15</em></div>
    <div><b>2.</b><a>수업 자료</a><em>02:36</em></div></body>`);
  assert.deepEqual(parseOutline(page.text), [
    { title: '시작하기', section: true },
    { title: '강의 소개', minutes: 21 },
    { title: '수업 자료', minutes: 3 },
  ]);
});

test('entities are decoded, and ones that would smuggle control characters are dropped', () => {
  assert.equal(decodeEntities('A &amp; B &lt;tag&gt; &#44032;&#x3A9; &nbsp;끝'), 'A & B <tag> 가Ω  끝');
  assert.equal(decodeEntities('&unknown; stays'), '&unknown; stays');
  assert.equal(decodeEntities('a&#0;b&#27;c&#xD800;d&#x110000;e'), 'a b c d e');
});

test('a Korean bookshop page in EUC-KR is read as Korean, not as noise', () => {
  // "목차"의 EUC-KR 바이트
  const bytes = Uint8Array.from([0x3c, 0x70, 0x3e, 0xb8, 0xf1, 0xc2, 0xf7, 0x3c, 0x2f, 0x70, 0x3e]);
  assert.equal(decodeBody(bytes, 'text/html; charset=EUC-KR'), '<p>목차</p>');
  assert.equal(decodeBody(bytes, 'text/html; charset=ks_c_5601-1987'), '<p>목차</p>');
  const declaredInside = new Uint8Array([...new TextEncoder().encode('<meta charset="euc-kr">'), 0xb8, 0xf1, 0xc2, 0xf7]);
  assert.ok(decodeBody(declaredInside, 'text/html').endsWith('목차'), 'a charset declared in the page is honoured');
  assert.equal(decodeBody(new TextEncoder().encode('목차'), 'text/html; charset=no-such-charset'), '목차', 'an unknown label falls back to UTF-8');
});

test('a long page is cut around the outline, not from the top', () => {
  const filler = Array.from({ length: 3000 }, (_, i) => `수강평 ${i} 정말 좋은 강의였습니다 추천합니다`);
  const lines = ['커리큘럼', ...filler, '커리큘럼', '섹션 1. 시작', '1.', '강의 소개', '20:15'];
  const text = focusOnOutline(lines);
  assert.ok(text.length <= MAX_TEXT);
  assert.ok(text.includes('강의 소개'), 'the outline at the bottom is kept');
  assert.ok(text.indexOf('커리큘럼') > 0 || text.startsWith('수강평'), 'the last marker is used, since the first is a menu link');
});

test('a short page is passed whole, and a long one with no marker keeps its beginning', () => {
  assert.equal(focusOnOutline(['a', 'b']), 'a\nb');
  const lines = Array.from({ length: 5000 }, (_, i) => `줄 ${i} 아무 내용이나 채운 글`);
  const text = focusOnOutline(lines);
  assert.equal(text.length, MAX_TEXT);
  assert.ok(text.startsWith('줄 0'));
});

test('a page drawn by script shows up as almost no text', () => {
  const page = extractPage('<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
  assert.equal(page.fullLength, 0);
  assert.equal(page.text, '');
});

import { outlineRegion } from '../apps/web/src/lib/page-text.ts';

test('only the part between the outline heading and the reviews is handed to the rules', () => {
  const text = ['이 강의는 반복 업무를 줄이는 방법을 다룹니다.', '커리큘럼', '1강 소개 12:30', '2강 설치 08:10', '수강평', '정말 좋은 강의였습니다', '5.0'].join('\n');
  assert.equal(outlineRegion(text), '1강 소개 12:30\n2강 설치 08:10');
  assert.deepEqual(parseOutline(outlineRegion(text)).map((u) => u.title), ['1강 소개', '2강 설치']);
});

test('with no outline heading nothing is guessed', () => {
  assert.equal(outlineRegion('소개 글\n1강 같은 줄 12:30\n가격 99,000원'), '');
});

test('the last heading wins, and an outline running to the end of the page is kept whole', () => {
  assert.equal(outlineRegion('목차\n메뉴 링크\n본문\n목차\nUnit 1\nUnit 2'), 'Unit 1\nUnit 2');
  // 문장 속에 "목차"가 들어간 긴 줄은 표시어가 아니다.
  assert.equal(outlineRegion(`이 책의 목차는 아래와 같이 구성되어 있으며 자세한 내용은 본문을 참고해 주시기 바랍니다\nUnit 1`), '');
});
