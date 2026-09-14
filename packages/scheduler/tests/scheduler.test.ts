import { describe, expect, it } from 'vitest';
import { scheduleBook, replanBook, scheduleBooks, estimateReadingSpeed, addDays, toStudyDate } from '../src/index.ts';
import type { BookInput, ExistingSession, ScheduleResult } from '../src/index.ts';

const week = [1, 2, 3, 4, 5].map(isoWeekday => ({ isoWeekday, availableMinutes: 120 }));
const book: BookInput = { totalPages: 320, completedThroughPage: 80, startDate: '2026-09-14', timezone: 'Asia/Seoul', mode: 'PACE', dailyPages: 20, minutesPerPage: 1, availability: week };
const session: ExistingSession = { id: 'old', studyDate: '2026-09-14', startPage: 81, endPage: 100, estimatedMinutes: 20, status: 'PLANNED', isLocked: false };
function success(result: ScheduleResult) {
  expect(result.status).not.toBe('conflict');
  if (result.status === 'conflict') throw new Error(result.conflicts[0]?.code);
  return result;
}
function code(result: ScheduleResult) {
  expect(result.status).toBe('conflict');
  return result.status === 'conflict' ? result.conflicts[0]?.code : null;
}

describe('acceptance examples', () => {
  it('allocates 240 pages in 12 weekday sessions', () => {
    const result = success(scheduleBook(book));
    expect(result.sessions).toHaveLength(12);
    expect(result.sessions[0]).toMatchObject({ studyDate: '2026-09-14', startPage: 81, endPage: 100 });
    expect(result.sessions.at(-1)).toMatchObject({ studyDate: '2026-09-29', startPage: 301, endPage: 320 });
    expect(result.forecastDate).toBe('2026-09-29');
  });
  it('distributes Deadline evenly over ten learning days', () => {
    const result = success(scheduleBook({ ...book, mode: 'DEADLINE', targetDate: '2026-09-25' }));
    expect(result.sessions).toHaveLength(10);
    expect(result.sessions.every(item => item.pages === 24)).toBe(true);
  });
  it.each([[90, '2026-09-30', 91], [120, '2026-09-28', 121]] as const)('replans after actual progress %i', (completedThroughPage, forecastDate, firstPage) => {
    const result = success(replanBook({ ...book, completedThroughPage, asOfDate: '2026-09-14', existingSessions: [session, { ...session, id: 'future', studyDate: '2026-09-15', startPage: 101, endPage: 120 }] }));
    expect(result.forecastDate).toBe(forecastDate);
    expect(result.sessions[0]?.startPage).toBe(firstPage);
    expect(result.preservedSessions).toEqual([session]);
    expect(result.replacedSessionIds).toEqual(['future']);
  });
  it('Balanced caps at 24 pages then extends by two days', () => {
    const result = success(scheduleBook({ ...book, mode: 'BALANCED', targetDate: '2026-09-23' }));
    expect(result.sessions).toHaveLength(10);
    expect(result.sessions.every(item => item.pages === 24)).toBe(true);
    expect(result.forecastDate).toBe('2026-09-25');
    expect(result.reasons.some(item => item.code === 'TARGET_EXTENDED')).toBe(true);
  });
  it('Balanced keeps preferred pace when the target has slack', () => {
    const result = success(scheduleBook({ ...book, mode: 'BALANCED', targetDate: '2026-10-30' }));
    expect(result.sessions[0]?.pages).toBe(20);
    expect(result.forecastDate).toBe('2026-09-29');
  });
});

describe('capacity and boundaries', () => {
  it('returns completed with no availability when nothing remains', () => {
    expect(scheduleBook({ ...book, completedThroughPage: 320, availability: [] })).toMatchObject({ status: 'completed', sessions: [], forecastDate: null });
  });
  it('reports no available days', () => expect(code(scheduleBook({ ...book, availability: [] }))).toBe('NO_AVAILABILITY'));
  it('rejects expired targets', () => expect(code(scheduleBook({ ...book, targetDate: '2026-09-13' }))).toBe('TARGET_IN_PAST'));
  it('reports Deadline capacity instead of a partial plan', () => {
    const result = scheduleBook({ ...book, mode: 'DEADLINE', targetDate: '2026-09-14' });
    expect(code(result)).toBe('DEADLINE_CAPACITY');
    expect(result).not.toHaveProperty('sessions');
  });
  it('Pace reports insufficient daily time without silently reducing workload', () => {
    expect(code(scheduleBook({ ...book, minutesPerPage: 10 }))).toBe('TIME_CAPACITY');
  });
  it('Balanced respects a smaller time budget', () => {
    const result = success(scheduleBook({ ...book, totalPages: 100, mode: 'BALANCED', minutesPerPage: 10 }));
    expect(result.sessions.map(item => item.pages)).toEqual([12, 8]);
  });
  it('Deadline accounts for a smaller last-day capacity', () => {
    const result = success(scheduleBook({ ...book, totalPages: 100, mode: 'DEADLINE', targetDate: '2026-09-15', availability: [{ isoWeekday: 1, availableMinutes: 19 }, { isoWeekday: 2, availableMinutes: 1 }] }));
    expect(result.sessions.map(item => item.pages)).toEqual([19, 1]);
  });
  it('does not round fractional estimated minutes up into a false conflict', () => {
    const result = success(scheduleBook({ ...book, totalPages: 83, dailyPages: 3, minutesPerPage: 0.3, availability: [{ isoWeekday: 1, availableMinutes: 0.9 }] }));
    expect(result.sessions[0]?.pages).toBe(3);
  });
  it('subtracts other resource reservations', () => {
    expect(code(scheduleBook({ ...book, reservedMinutes: [{ studyDate: '2026-09-14', minutes: 110 }] }))).toBe('TIME_CAPACITY');
  });
  it('bounds searches', () => expect(code(scheduleBook({ ...book, maxDays: 1 }))).toBe('HORIZON_EXCEEDED'));
  it.each([
    { startDate: '2026-02-30' }, { totalPages: Infinity }, { completedThroughPage: 321 },
    { dailyPages: 1.5 }, { minutesPerPage: 0 }, { timezone: 'Mars/Olympus' },
    { availability: [week[0]!, week[0]!] }, { reservedMinutes: [{ studyDate: '2026-09-14', minutes: -1 }] },
  ])('rejects invalid input %j', patch => expect(code(scheduleBook({ ...book, ...patch }))).toBe('INVALID_INPUT'));
});

describe('preservation', () => {
  const pinned = { ...session, id: 'pinned', studyDate: '2026-09-16', startPage: 101, endPage: 120, isLocked: true };
  it('preserves a future pin and allocates each remaining page exactly once', () => {
    const result = success(replanBook({ ...book, asOfDate: '2026-09-14', existingSessions: [session, pinned] }));
    expect(result.preservedSessions).toEqual([session, pinned]);
    const pages = [...result.sessions, pinned].flatMap(item => Array.from({ length: item.endPage - item.startPage + 1 }, (_, i) => item.startPage + i)).sort((a,b) => a-b);
    expect(pages).toEqual(Array.from({length: 240}, (_,i) => 81+i));
    expect(result.sessions.filter(item => item.startPage > 120).every(item => item.studyDate >= pinned.studyDate)).toBe(true);
  });
  it('reports pinned pages already read while preserving the original', () => {
    const result = replanBook({ ...book, completedThroughPage: 110, asOfDate: '2026-09-14', existingSessions: [pinned] });
    expect(code(result)).toBe('PINNED_OVERLAP');
    expect(result.preservedSessions).toEqual([pinned]);
  });
  it('rejects overlapping future pins', () => expect(code(replanBook({ ...book, asOfDate: '2026-09-14', existingSessions: [pinned, {...pinned, id: 'duplicate'}] }))).toBe('PINNED_OVERLAP'));
  it('rejects pins on unavailable days', () => expect(code(replanBook({ ...book, asOfDate: '2026-09-14', existingSessions: [{...pinned, studyDate:'2026-09-19'}] }))).toBe('PINNED_CAPACITY'));
  it('does not pretend a pin before its prerequisites is feasible', () => expect(code(replanBook({ ...book, asOfDate: '2026-09-14', existingSessions: [{...pinned, studyDate:'2026-09-15'}] }))).toBe('PINNED_ORDER'));
  it('preserves completed and in-progress sessions', () => {
    const completed = {...session, id:'completed', studyDate:'2026-09-16', startPage:1, endPage:20, status:'COMPLETED' as const};
    const active = {...pinned, id:'active', isLocked:false, status:'IN_PROGRESS' as const};
    expect(success(replanBook({...book, asOfDate:'2026-09-14', existingSessions:[completed,active]})).preservedSessions).toEqual([completed,active]);
  });
  it('is deterministic and leaves input unchanged', () => {
    const input = { ...book, asOfDate: '2026-09-14', existingSessions:[session,pinned] };
    const before = JSON.stringify(input);
    expect(replanBook(input)).toEqual(replanBook(input));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('calendar and speed', () => {
  it('handles leap days', () => expect(addDays('2028-02-28',1)).toBe('2028-02-29'));
  it('maps an instant to the user study day', () => expect(toStudyDate('2026-09-13T16:00:00Z','Asia/Seoul')).toBe('2026-09-14'));
  it('uses calendar arithmetic across DST', () => expect(addDays('2026-03-08',1)).toBe('2026-03-09'));
  it('uses fallback when there are fewer than three timed samples', () => {
    expect(estimateReadingSpeed({asOfDate:'2026-09-14',fallbackMinutesPerPage:2,samples:[]})).toMatchObject({source:'fallback',minutesPerPage:2,sampleCount:0});
  });
  it('uses weighted observed speed and excludes review, zero time and old samples', () => {
    const samples = [10,20,30].map((pages,i) => ({id:String(i),studyDate:'2026-09-14',kind:'LEARNING' as const,pages,minutes:10}));
    samples.push({id:'zero',studyDate:'2026-09-14',kind:'LEARNING',pages:100,minutes:0}, {id:'old',studyDate:'2026-01-01',kind:'LEARNING',pages:100,minutes:1});
    const result = estimateReadingSpeed({asOfDate:'2026-09-14',fallbackMinutesPerPage:2,samples:[...samples,{id:'review',studyDate:'2026-09-14',kind:'REVIEW',pages:100,minutes:1}]});
    expect(result).toMatchObject({source:'observed',minutesPerPage:0.5,sampleCount:3,totalPages:60,totalMinutes:30});
  });
});

describe('shared user time', () => {
  it('never gives two resources the same entire daily budget', () => {
    const { availability, timezone, ...input } = {...book,totalPages:100,dailyPages:10};
    const result = scheduleBooks({availability:[{isoWeekday:1,availableMinutes:10},{isoWeekday:2,availableMinutes:10}],timezone,books:[{id:'a',input},{id:'b',input}]});
    expect(result.status).toBe('conflict');
  });
  it('allows two resources to share spare time', () => {
    const { availability, timezone, ...input } = {...book,totalPages:100,dailyPages:10};
    const result = scheduleBooks({availability,timezone,books:[{id:'a',input},{id:'b',input}]});
    expect(result.status).toBe('ok');
  });
});
