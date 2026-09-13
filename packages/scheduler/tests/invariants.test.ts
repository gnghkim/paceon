import { expect, it } from 'vitest';
import { scheduleBook, replanBook, estimateReadingSpeed, addDays, toStudyDate } from '../src/index.ts';
import type { BookInput } from '../src/index.ts';

const base: BookInput = { totalPages:100, completedThroughPage:0, startDate:'2026-09-14', timezone:'Asia/Seoul', mode:'PACE', dailyPages:20, minutesPerPage:1, availability:[1,2,3,4,5].map(isoWeekday => ({isoWeekday,availableMinutes:60})) };

it('Deadline does not require an unused preferred daily workload', () => {
  const {dailyPages,...input}=base;
  expect(scheduleBook({...input,mode:'DEADLINE',targetDate:'2026-09-18'})).toMatchObject({status:'ok'});
});

it('Balanced without a target does not treat the search horizon as a deadline', () => {
  expect(scheduleBook({...base,mode:'BALANCED',totalPages:23,maxDays:1})).toMatchObject({status:'conflict',conflicts:[{code:'HORIZON_EXCEEDED'}]});
});

for (const mode of ['PACE','DEADLINE','BALANCED'] as const) {
  it(`${mode}: conserves every remaining page and obeys capacity across 100 varying inputs`, () => {
    for (let i=1;i<=100;i++) {
      const completedThroughPage=i%13;
      const totalPages=completedThroughPage+i*3;
      const input = {...base,mode,totalPages,completedThroughPage,dailyPages:5+i%15,targetDate:'2026-10-30',minutesPerPage:0.5+(i%4)*0.5};
      const snapshot=JSON.stringify(input);
      const result=scheduleBook(input);
      expect(result.status).toBe('ok');
      if (result.status==='conflict') continue;
      let expectedPage=completedThroughPage+1;
      const byDay=new Map<string,number>();
      let previousDate=input.startDate;
      for (const session of result.sessions) {
        expect(session.startPage).toBe(expectedPage);
        expect(session.endPage-session.startPage+1).toBe(session.pages);
        expect(session.studyDate >= previousDate).toBe(true);
        expect([1,2,3,4,5]).toContain(new Date(`${session.studyDate}T00:00:00Z`).getUTCDay());
        byDay.set(session.studyDate,(byDay.get(session.studyDate)??0)+session.estimatedMinutes);
        if (mode==='PACE') expect(session.pages).toBeLessThanOrEqual(input.dailyPages);
        if (mode==='BALANCED') expect(session.pages).toBeLessThanOrEqual(Math.floor(input.dailyPages*1.2));
        previousDate=session.studyDate;
        expectedPage=session.endPage+1;
      }
      expect(expectedPage).toBe(totalPages+1);
      expect([...byDay.values()].every(minutes => minutes<=60)).toBe(true);
      expect(result.forecastDate).toBe(result.sessions.at(-1)?.studyDate);
      expect(JSON.stringify(input)).toBe(snapshot);
    }
  });
}

it('handles year end and maximum calendar boundary without wrapping', () => {
  expect(addDays('2026-12-31',1)).toBe('2027-01-01');
  expect(() => addDays('9999-12-31',1)).toThrow();
  expect(scheduleBook({...base,startDate:'9999-12-31',totalPages:100})).toMatchObject({status:'conflict'});
});

it('uses local timezone even when UTC is already the next day', () => {
  expect(toStudyDate('2026-09-14T01:00:00Z','America/Los_Angeles')).toBe('2026-09-13');
  expect(() => toStudyDate('2026-09-14T01:00:00','Asia/Seoul')).toThrow();
});

it('rejects duplicate speed sample IDs', () => {
  const sample={id:'one',studyDate:'2026-09-14',kind:'LEARNING' as const,pages:10,minutes:5};
  expect(() => estimateReadingSpeed({asOfDate:'2026-09-14',fallbackMinutesPerPage:2,samples:[sample,sample]})).toThrow();
});

it('includes only the exact rolling observation window', () => {
  const samples=['2026-08-15','2026-08-16','2026-09-14','2026-09-15'].map((studyDate,i)=>({id:String(i),studyDate,kind:'LEARNING' as const,pages:10,minutes:10}));
  expect(estimateReadingSpeed({asOfDate:'2026-09-14',fallbackMinutesPerPage:2,samples})).toMatchObject({source:'fallback',sampleCount:2});
});

it('does not overwrite past, today, or locked input objects even on conflict', () => {
  const pinned=Object.freeze({id:'p',studyDate:'2026-09-15',startPage:1,endPage:20,estimatedMinutes:80,status:'PLANNED' as const,isLocked:true});
  const existing=Object.freeze([pinned]);
  const result=replanBook({...base,asOfDate:'2026-09-14',existingSessions:existing});
  expect(result).toMatchObject({status:'conflict',preservedSessions:[pinned],conflicts:[{code:'PINNED_CAPACITY'}]});
  expect(result).not.toHaveProperty('replacedSessionIds');
});

it('returns a conflict for duplicate existing session identities', () => {
  const item={id:'same',studyDate:'2026-09-16',startPage:1,endPage:20,estimatedMinutes:20,status:'PLANNED' as const,isLocked:false};
  expect(replanBook({...base,asOfDate:'2026-09-14',existingSessions:[item,item]})).toMatchObject({status:'conflict',conflicts:[{code:'INVALID_INPUT'}]});
});

it('does not duplicate a future pin before a later requested start date', () => {
  const pin={id:'early',studyDate:'2026-09-16',startPage:1,endPage:20,estimatedMinutes:20,status:'PLANNED' as const,isLocked:true};
  expect(replanBook({...base,startDate:'2026-09-21',totalPages:40,asOfDate:'2026-09-14',existingSessions:[pin]})).toMatchObject({status:'conflict',preservedSessions:[pin],conflicts:[{code:'PINNED_ORDER'}]});
});

it('checks every future completed session against actual progress, even before a later start', () => {
  const completed={id:'done',studyDate:'2026-09-16',startPage:1,endPage:20,estimatedMinutes:20,status:'COMPLETED' as const,isLocked:false};
  expect(replanBook({...base,startDate:'2026-09-21',asOfDate:'2026-09-14',existingSessions:[completed]})).toMatchObject({status:'conflict',conflicts:[{code:'PROGRESS_MISMATCH'}]});
});

it('rejects underflow in an observed speed instead of returning zero minutes per page', () => {
  const samples=[1,2,3].map(id=>({id:String(id),studyDate:'2026-09-14',kind:'LEARNING' as const,pages:1_000_000,minutes:Number.MIN_VALUE}));
  expect(()=>estimateReadingSpeed({asOfDate:'2026-09-14',fallbackMinutesPerPage:2,samples})).toThrow();
});
