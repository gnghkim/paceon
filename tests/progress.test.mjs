import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProgressRequest, projectProgress, calculateProgressCandidate, ProgressError } from '../apps/web/src/lib/progress.ts';
const id = '12345678-1234-4234-9234-123456789abc';
const base = { idempotencyKey:id, planId:id, expectedPlanVersion:1, expectedProgressVersion:0 };
const book = { total_pages:100, initial_completed_workload:0 };
const plan = { mode:'PACE', preferred_daily_workload:20, target_date:null, start_date:'2026-09-01', timezone:'Asia/Seoul', minutes_per_page:1 };
const availability = Array.from({length:7}, (_,i)=>({iso_weekday:i+1,available_minutes:60}));
const event = (id,start,end,extra={})=>({id,event_type:'LEARNING',start_page:start,end_page:end,completed_workload:end-start+1,duration_minutes:20,study_date:'2026-09-12',voids_event_id:null,session_id:null,...extra});
const request = (extra={})=>parseProgressRequest({...base,kind:'LEARNING',studyDate:'2026-09-13',endPage:10,...extra});
const calc = (extra={})=>calculateProgressCandidate({book,plan,availability,events:[],sessions:[],otherSessions:[],request:request(),asOfDate:'2026-09-13',...extra});
test('request canonicalizes defaults and rejects unknown or inappropriate fields',()=>{
 assert.equal(request().memo,''); assert.equal(request().durationMinutes,null);
 for(const extra of [{surprise:1},{startPage:1},{mode:'PACE'},{studyDate:'2026-02-30'},{endPage:0},{durationMinutes:-1}]) assert.throws(()=>request(extra));
 assert.throws(()=>parseProgressRequest({...base,kind:'REPLAN',endPage:1}));
});
test('projection sorts ranges, ignores review and voided learning without mutating inputs',()=>{
 const events=[event('b',11,20),event('r',1,40,{event_type:'REVIEW'}),event('a',1,10),event('c',21,30),event('v',null,null,{event_type:'VOID',voids_event_id:'c'})];
 const before=JSON.stringify(events); const result=projectProgress(book,events);
 assert.equal(result.completedThroughPage,20);assert.equal(result.percent,20);assert.equal(result.latestLearningId,'b');assert.equal(JSON.stringify(events),before);
});
test('projection rejects gaps overlap duplicate event IDs and invalid initial pages',()=>{
 for(const events of [[event('a',2,10)],[event('a',1,10),event('b',10,20)],[event('a',1,10),event('a',11,20)]]) assert.throws(()=>projectProgress(book,events),ProgressError);
 assert.throws(()=>projectProgress({...book,initial_completed_workload:101},[]),ProgressError);
});
test('under and over target actuals replan future pages, preserving originals',()=>{
 for(const endPage of [5,35]) {
 const input={request:request({endPage})};const before=JSON.stringify(input);const result=calc(input);
 assert.equal(result.completedThroughPage,endPage);assert.equal(result.schedule.sessions[0].startPage,endPage+1);assert.equal(result.schedule.sessions[0].studyDate,'2026-09-14');assert.equal(JSON.stringify(input),before);
 assert.equal(result.mode,'PACE');assert.equal(result.dailyPages,20);assert.equal(result.targetDate,null);
 }
});
test('review contributes no pages; future records and out of book pages are rejected',()=>{
 assert.equal(calc({request:request({kind:'REVIEW',startPage:1,endPage:10})}).completedThroughPage,0);
 assert.throws(()=>calc({request:request({studyDate:'2026-09-14'})}),ProgressError);
 assert.throws(()=>calc({request:request({endPage:101})}),ProgressError);
});
test('correction targets last learning and permits a complete void',()=>{
 const events=[event(id,1,10)];
 const corrected=calc({events,request:request({kind:'CORRECTION',eventId:id,endPage:5})});assert.equal(corrected.completedThroughPage,5);
 assert.equal(calc({events,request:request({kind:'CORRECTION',eventId:id,endPage:0})}).completedThroughPage,0);
 assert.throws(()=>calc({events:[...events,event('new',11,20)],request:request({kind:'CORRECTION',eventId:id,endPage:5})}),ProgressError);
});
test('three valid recent learning samples determine weighted speed; review excluded',()=>{
 const events=[event('a',1,10),event('b',11,20)];
 const result=calc({events,request:request({endPage:30,durationMinutes:20})});assert.equal(result.speedSource,'observed');assert.equal(result.minutesPerPage,2);
 assert.equal(calc({events:[event('a',1,10),event('b',11,20,{study_date:'2026-08-01'})],request:request({endPage:30,durationMinutes:20})}).speedSource,'fallback');
 assert.equal(calc({events,request:request({kind:'REVIEW',startPage:1,endPage:10,durationMinutes:100})}).speedSource,'fallback');
});
test('shared time conflicts remain candidates, with actual progress intact',()=>{
 const result=calc({otherSessions:[{study_date:'2026-09-14',estimated_minutes:55}]});assert.equal(result.completedThroughPage,10);assert.equal(result.schedule.status,'conflict');
});
test('completion forecast uses server today and fractional minutes round without floating noise',()=>{
 assert.equal(calc({request:request({endPage:100})}).schedule.forecastDate,'2026-09-13');
 const result=calc({plan:{...plan,minutes_per_page:0.1,preferred_daily_workload:30}});assert.equal(result.schedule.sessions[0].estimatedMinutes,3);
});
test('event-referenced future sessions cannot be replaced and original plan start is respected',()=>{
 const sessions=[{id:'future',study_date:'2026-09-20',start_page:21,end_page:40,estimated_minutes:20,status:'PLANNED',is_locked:false}];
 const result=calc({sessions,events:[event('review',1,10,{event_type:'REVIEW',session_id:'future'})]});
 assert.ok(result.schedule.preservedSessions.some(s=>s.id==='future'));
 assert.equal(calc({plan:{...plan,start_date:'2026-10-01'}}).schedule.sessions[0].studyDate,'2026-10-01');
});
test('manual replan overrides policy and returns explicit cleared target',()=>{
 const result=calc({request:parseProgressRequest({...base,kind:'REPLAN',mode:'BALANCED',dailyPages:5,targetDate:null})});
 assert.equal(result.mode,'BALANCED');assert.equal(result.dailyPages,5);assert.equal(result.targetDate,null);assert.equal(result.completedThroughPage,0);
});
test('correction removes old speed sample and zero duration never counts',()=>{
 const events=[event('a',1,10),event('b',11,20),event(id,21,30)];
 const result=calc({events,request:request({kind:'CORRECTION',eventId:id,endPage:30,durationMinutes:0})});
 assert.equal(result.speedSource,'fallback');assert.equal(result.minutesPerPage,1);
});
test('all history and fixed session statuses survive replacement selection',()=>{
 const sessions=[
 {id:'past',study_date:'2026-09-12',start_page:1,end_page:20,estimated_minutes:20,status:'SKIPPED',is_locked:false},
 {id:'today',study_date:'2026-09-13',start_page:1,end_page:20,estimated_minutes:20,status:'PLANNED',is_locked:false},
 {id:'replace',study_date:'2026-09-15',start_page:21,end_page:40,estimated_minutes:20,status:'SKIPPED',is_locked:false},
 ];
 const before=JSON.stringify(sessions);const result=calc({sessions});
 assert.deepEqual(result.schedule.replacedSessionIds,['replace']);assert.deepEqual(result.schedule.preservedSessions.map(s=>s.id),['past','today']);assert.equal(JSON.stringify(sessions),before);
});
test('rounded split sessions cannot exceed shared daily integer minute budget',()=>{
 const result=calc({book:{...book,total_pages:4},plan:{...plan,mode:'DEADLINE',target_date:'2026-09-14',minutes_per_page:0.6},
 request:parseProgressRequest({...base,kind:'REPLAN'}),availability:availability.map(a=>({...a,available_minutes:3})),
 sessions:[{id:'pin',study_date:'2026-09-14',start_page:3,end_page:3,estimated_minutes:1,status:'PLANNED',is_locked:true}]});
 assert.equal(result.schedule.status,'conflict');
});
