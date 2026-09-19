import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchErrorText, fitPlan, freeMinutesByWeekday, readProposal } from '../apps/web/src/lib/material-import.ts';

const good = {
  found: true,
  title: '  업무 자동화 실전  ',
  kind: 'COURSE',
  unitLabel: '강',
  units: [
    { title: '시작하기', minutes: null, section: true },
    { title: '강의 소개', minutes: 21, section: false },
    { title: '수업 자료', minutes: null, section: false },
    { title: '끝에 혼자 남은 섹션', minutes: null, section: true },
  ],
  plan: { dailyUnits: 2, minutesPerUnit: 20, reason: '하루 60분 안에 두 강이 들어가요.' },
};

test('a stored proposal becomes an outline the form can show', () => {
  const proposal = readProposal(good);
  assert.equal(proposal.title, '업무 자동화 실전');
  assert.deepEqual(proposal.units, [
    { title: '시작하기', section: true },
    { title: '강의 소개', minutes: 21 },
    { title: '수업 자료' },
  ]);
  assert.equal(proposal.kind, 'COURSE');
});

test('a result that found nothing, or is not shaped right, is no proposal at all', () => {
  assert.equal(readProposal({ ...good, found: false }), null);
  assert.equal(readProposal({ ...good, units: [{ title: 'Part 1', minutes: null, section: true }] }), null, 'headings alone cannot be studied');
  for (const broken of [null, 'text', {}, { ...good, kind: 'NOVEL' }, { ...good, units: 'none' }, { ...good, units: [{ title: '', minutes: 1, section: false }] },
    { ...good, units: [{ title: 'a', minutes: 0, section: false }] }, { ...good, plan: { dailyUnits: 0, minutesPerUnit: 1, reason: 'x' } }])
    assert.equal(readProposal(broken), null, JSON.stringify(broken)?.slice(0, 60));
});

test('fields the form never asked for are dropped, not passed on', () => {
  const proposal = readProposal({ ...good, script: '<script>', units: [{ title: 'a', minutes: 5, section: false, url: 'https://evil' }] });
  assert.deepEqual(proposal.units, [{ title: 'a', minutes: 5 }]);
  assert.equal('script' in proposal, false);
});

const everyDay = (minutes) => [1, 2, 3, 4, 5, 6, 7].map((iso_weekday) => ({ iso_weekday, available_minutes: minutes }));
// 2026-09-21은 월요일이다.
const session = (study_date, estimated_minutes, status = 'PLANNED') => ({ study_date, estimated_minutes, status });

test('free time is what is available less what other plans already hold on that weekday', () => {
  const sessions = [
    ...['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'].map((day) => session(day, 40)), // 월요일마다 40분
    session('2026-09-22', 20), // 화요일 한 번뿐 → 네 주 평균 5분
  ];
  assert.deepEqual(freeMinutesByWeekday(everyDay(60), sessions, '2026-09-20'), [20, 55, 60, 60, 60, 60, 60]);
});

test('today, the past, finished and skipped sessions do not count against the weeks ahead', () => {
  const sessions = [session('2026-09-20', 60), session('2026-09-10', 60), session('2026-09-21', 60, 'COMPLETED'), session('2026-09-21', 60, 'SKIPPED'), session('2026-12-25', 60)];
  assert.deepEqual(freeMinutesByWeekday(everyDay(60), sessions, '2026-09-20'), [60, 60, 60, 60, 60, 60, 60]);
});

test('a weekday with no study time, or one already overbooked, has none free', () => {
  const availability = [{ iso_weekday: 1, available_minutes: 30 }];
  const sessions = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'].map((day) => session(day, 90));
  assert.deepEqual(freeMinutesByWeekday(availability, sessions, '2026-09-20'), [0, 0, 0, 0, 0, 0, 0]);
});

const lectures = (minutes) => minutes.map((m, i) => ({ title: `${i + 1}강`, minutes: m }));

test('a pace that fits the usual day is left as the AI proposed it', () => {
  const plan = { dailyUnits: 2, minutesPerUnit: 20, reason: 'AI의 말' };
  assert.deepEqual(fitPlan(plan, lectures([20, 20, 25]), [60, 60, 0, 60, 60, 120, 120]), { ...plan, adjusted: false });
});

test('a pace that would not fit is brought down, and the reason is rewritten to match', () => {
  const fitted = fitPlan({ dailyUnits: 5, minutesPerUnit: 20, reason: '하루 다섯 강을 권해요.' }, lectures([30, 30, 30]), [35, 35, 0, 35, 35, 35, 35]);
  assert.equal(fitted.dailyUnits, 1);
  assert.equal(fitted.adjusted, true);
  assert.match(fitted.reason, /35분/);
  assert.match(fitted.reason, /30분/);
  assert.doesNotMatch(fitted.reason, /다섯/, 'the old sentence would contradict the new number');
});

test('even a lecture longer than the day still gets a pace of one, never zero', () => {
  assert.equal(fitPlan({ dailyUnits: 3, minutesPerUnit: 90, reason: 'x' }, lectures([90, 90]), [30, 30, 30, 30, 30, 0, 0]).dailyUnits, 1);
});

test('with no study time set at all, the proposal is left alone for the plan step to refuse', () => {
  const plan = { dailyUnits: 3, minutesPerUnit: 20, reason: 'x' };
  assert.deepEqual(fitPlan(plan, lectures([20]), [0, 0, 0, 0, 0, 0, 0]), { ...plan, adjusted: false });
});

test('the usual day ignores rest days, so a weekend off does not drag the pace to nothing', () => {
  const fitted = fitPlan({ dailyUnits: 2, minutesPerUnit: 25, reason: 'x' }, lectures([25, 25]), [60, 60, 60, 60, 60, 0, 0]);
  assert.equal(fitted.adjusted, false);
});

test('every way a page can fail to load has words a reader can act on', () => {
  for (const reason of ['INVALID_URL', 'NOT_HTTPS', 'HAS_CREDENTIALS', 'BAD_PORT', 'IP_LITERAL', 'LOCAL_NAME', 'PRIVATE_ADDRESS', 'TOO_MANY_REDIRECTS', 'NOT_HTML', 'TOO_LARGE', 'TIMEOUT', 'HTTP_ERROR', 'NETWORK'])
    assert.match(fetchErrorText[reason] ?? '', /[가-힣]/, reason);
  // 내부망을 가리켜 막힌 경우, 막힌 이유를 자세히 알려 주지 않는다.
  assert.equal(fetchErrorText.PRIVATE_ADDRESS, fetchErrorText.LOCAL_NAME);
});

import { chooseOutline, tidyTitles } from '../apps/web/src/lib/material-import.ts';

test('numbers the AI copied into titles are taken off, since order is kept separately', () => {
  assert.deepEqual(
    tidyTitles([
      { title: '섹션 1. [필수 시청] 오리엔테이션', section: true },
      { title: '1. 강의 소개', minutes: 21 },
      { title: '12) 정리' },
      { title: 'Chapter 3: Past tense', section: true },
      { title: '2026년 회고' },
      { title: '7.' },
    ]),
    [
      { title: '[필수 시청] 오리엔테이션', section: true },
      { title: '강의 소개', minutes: 21 },
      { title: '정리' },
      { title: 'Past tense', section: true },
      { title: '2026년 회고' },
      { title: '7.' },
    ],
  );
});

test('when the rules read more of the page than the AI did, the rules are kept', () => {
  // 실제로 있었던 일: AI가 접힌 섹션 넷을 빠뜨렸다.
  const ruled = [{ title: '강의 소개', minutes: 21 }, { title: '실습', minutes: 16 }, { title: '심화', minutes: 74 }, { title: '라이브', minutes: 117 }];
  const ai = [{ title: '1. 강의 소개', minutes: 21 }, { title: '2. 실습', minutes: 16 }];
  assert.deepEqual(chooseOutline(ruled, ai), { units: ruled, source: 'RULES' });
});

test('when the AI read more, or the rules found nothing, the AI is used with tidy titles', () => {
  const ai = [{ title: '1. Unit one', minutes: 30 }, { title: '2. Unit two', minutes: 30 }];
  assert.deepEqual(chooseOutline([], ai), { units: [{ title: 'Unit one', minutes: 30 }, { title: 'Unit two', minutes: 30 }], source: 'AI' });
  assert.equal(chooseOutline([{ title: 'a', minutes: 10 }], ai).source, 'AI');
});

test('when both read the same time, the rules are kept, since they cannot invent', () => {
  // 실제로 있었던 일: 같은 435분을 읽고도 AI는 묶음 제목을 빠뜨리고 하나를 강의로 넣었다.
  const ruled = [{ title: '시작하기', section: true }, { title: '소개', minutes: 21 }, { title: '심화', minutes: 74 }];
  const ai = [{ title: '시작하기' }, { title: '소개', minutes: 21 }, { title: '심화', minutes: 74 }];
  assert.equal(chooseOutline(ruled, ai).source, 'RULES');
});

test('with no lengths at all, as in a book, the longer outline wins and a tie goes to the AI', () => {
  const two = [{ title: 'a' }, { title: 'b' }];
  const three = [{ title: 'a' }, { title: 'b' }, { title: 'c' }];
  assert.equal(chooseOutline(three, two).source, 'RULES');
  assert.equal(chooseOutline(two, three).source, 'AI');
  assert.equal(chooseOutline(two, two).source, 'AI');
  assert.equal(chooseOutline(two, [{ title: '섹션만', section: true }]).source, 'RULES', 'an AI answer of only headings is nothing');
});

import { trustRulesDespiteNotFound } from '../apps/web/src/lib/material-import.ts';

test('when the AI says there is no outline, a thin rule-based guess is not shown as one', () => {
  // 실제로 있었던 일: 백과사전 문서의 자체 차례 세 줄을 강의 목차로 보여 줬다.
  assert.equal(trustRulesDespiteNotFound([{ title: 'History' }, { title: 'Editions' }, { title: 'References' }]), false);
  assert.equal(trustRulesDespiteNotFound([]), false);
});

test('but a substantial one survives, since the AI can also be wrong', () => {
  assert.equal(trustRulesDespiteNotFound([{ title: '1강', minutes: 12 }, { title: '2강' }]), true, 'lengths are evidence of a real syllabus');
  assert.equal(trustRulesDespiteNotFound(Array.from({ length: 8 }, (_, i) => ({ title: `Unit ${i + 1}` }))), true);
  assert.equal(trustRulesDespiteNotFound([...Array.from({ length: 7 }, (_, i) => ({ title: `Unit ${i + 1}` })), { title: 'Part', section: true }]), false, 'headings do not count');
});
