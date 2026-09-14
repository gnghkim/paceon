begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_column('public','resources','progress_version','Progress revision exists');
select has_column('public','resources','replan_required','Pending flag exists');
select has_column('public','plans','minutes_per_page','Fallback speed exists');
select has_table('public','progress_submissions','Submission ledger exists');
select has_function('public','submit_book_progress',array['uuid','jsonb','jsonb','jsonb','integer','numeric','date']);
select ok(not has_function_privilege('anon','public.submit_book_progress(uuid,jsonb,jsonb,jsonb,integer,numeric,date)','execute'),'Anonymous cannot submit');
select is((select prosecdef from pg_proc where oid='public.submit_book_progress(uuid,jsonb,jsonb,jsonb,integer,numeric,date)'::regprocedure),false,'Caller RLS is preserved');
select ok(not has_table_privilege('authenticated','public.progress_submissions','UPDATE,DELETE'),'Ledger is append only');
select throws_ok($$select public.submit_book_progress('00000000-0000-0000-0000-000000000000','{}','{}','[]',100,0,current_date)$$,'42501','Authentication required','Anonymous caller rejected');
insert into auth.users(id,email) values('19000000-0000-4000-8000-000000000001','progress-pending@paceon.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','19000000-0000-4000-8000-000000000001',true);
insert into resources(id,user_id,title,type,total_pages,status) values('29000000-0000-4000-8000-000000000001',auth.uid(),'Completed before planned start','BOOK',10,'COMPLETED');
insert into goals(id,user_id,resource_id,title,start_date,mode,preferred_daily_workload) values('39000000-0000-4000-8000-000000000001',auth.uid(),'29000000-0000-4000-8000-000000000001','Read',current_date+1,'PACE',2);
insert into plans(id,user_id,resource_id,goal_id,start_date,forecast_date,timezone,mode,preferred_daily_workload,status) values('49000000-0000-4000-8000-000000000001',auth.uid(),'29000000-0000-4000-8000-000000000001','39000000-0000-4000-8000-000000000001',current_date+1,current_date,'UTC','PACE',2,'COMPLETED');
insert into progress_events(id,user_id,resource_id,study_date,timezone,start_page,end_page,completed_workload,idempotency_key) values('59000000-0000-4000-8000-000000000001',auth.uid(),'29000000-0000-4000-8000-000000000001',current_date,'UTC',1,10,10,gen_random_uuid());
create temporary table pending_result as select submit_book_progress('29000000-0000-4000-8000-000000000001',
 jsonb_build_object('kind','CORRECTION','idempotencyKey','69000000-0000-4000-8000-000000000001','planId','49000000-0000-4000-8000-000000000001','eventId','59000000-0000-4000-8000-000000000001','expectedPlanVersion',1,'expectedProgressVersion',0,'studyDate',current_date,'endPage',5),
 '{"completedThroughPage":5,"minutesPerPage":1,"speedSource":"fallback","mode":"PACE","dailyPages":2,"targetDate":null,"schedule":{"status":"conflict","preservedSessions":[],"conflicts":[{"code":"NO_AVAILABILITY","detail":"No available days"}]}}',
 '[]',10,0,current_date) result;
select is((select status::text from plans where id='49000000-0000-4000-8000-000000000001'),'ACTIVE','Pending correction reopens completed plan');
select is((select version from plans where id='49000000-0000-4000-8000-000000000001'),2::bigint,'Completion status transition advances ordinary plan version');
select is((select forecast_date from plans where id='49000000-0000-4000-8000-000000000001'),null::date,'Reopening clears completion forecast before plan start');
select is((select result->>'replanStatus' from pending_result),'pending','Correction conflict retains pending result');
select is((select result->>'planVersion' from pending_result),'2','Returned revision includes status change');
select ok((select replan_required and status='ACTIVE' from resources where id='29000000-0000-4000-8000-000000000001'),'Resource reopens with pending flag');
select is((select count(*) from progress_events where resource_id='29000000-0000-4000-8000-000000000001'),3::bigint,'Original, VOID and replacement persist');
select is((select to_version-from_version from replan_runs where resource_id='29000000-0000-4000-8000-000000000001'),1::bigint,'Skipped run can record status revision');
reset role;
select lives_ok($$delete from auth.users where id='19000000-0000-4000-8000-000000000001'$$,'Ledger permits account cleanup cascade');
select * from finish();
rollback;


