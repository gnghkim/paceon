begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'rls-alice@paceon.example'),
  ('10000000-0000-4000-8000-000000000002', 'rls-bob@paceon.example');
insert into public.resources (id,user_id,title,type,total_pages,initial_completed_workload) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Alice book','BOOK',320,80),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Bob book','BOOK',100,0),
  ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Alice second book','BOOK',100,0);
insert into public.resource_units (id,user_id,resource_id,title,sequence,unit_type,start_page,end_page) values
  ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Chapter',1,'CHAPTER',81,100),
  ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Chapter',1,'CHAPTER',1,20);
insert into public.goals (id,user_id,resource_id,title,start_date,mode,preferred_daily_workload) values
  ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Read',date '2026-09-14','PACE',20),
  ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Read',date '2026-09-14','PACE',20);
insert into public.plans (id,user_id,resource_id,goal_id,start_date,mode,preferred_daily_workload) values
  ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',date '2026-09-14','PACE',20),
  ('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',date '2026-09-14','PACE',20);
insert into public.schedule_sessions (id,user_id,resource_id,plan_id,study_date,planned_workload,start_page,end_page) values
  ('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',date '2026-09-14',20,81,100),
  ('60000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002',date '2026-09-14',20,1,20);
insert into public.availability_rules(user_id,iso_weekday,available_minutes) values
  ('10000000-0000-4000-8000-000000000001',1,60),('10000000-0000-4000-8000-000000000002',1,30);
insert into public.learner_profiles(user_id) values
  ('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select is((select count(*) from resources),2::bigint,'Alice sees only her resources');
select is((select count(*) from resource_units),1::bigint,'units isolated');
select is((select count(*) from goals),1::bigint,'goals isolated');
select is((select count(*) from plans),1::bigint,'plans isolated');
select is((select count(*) from schedule_sessions),1::bigint,'sessions isolated');
select is((select count(*) from availability_rules),1::bigint,'availability isolated');
select is((select count(*) from learner_profiles),1::bigint,'profiles isolated');
with changed as (update resources set title='stolen' where id='20000000-0000-4000-8000-000000000002' returning id) select is((select count(*) from changed),0::bigint,'cannot update Bob');
with removed as (delete from resources where id='20000000-0000-4000-8000-000000000002' returning id) select is((select count(*) from removed),0::bigint,'cannot delete Bob');
select throws_ok($$insert into resources(user_id,title,type,total_pages) values ('10000000-0000-4000-8000-000000000002','forged','BOOK',10)$$,'42501',null,'cannot insert as Bob');
select throws_ok($$update resources set user_id='10000000-0000-4000-8000-000000000002' where id='20000000-0000-4000-8000-000000000003'$$,'42501',null,'cannot transfer ownership');
select throws_ok($$insert into goals(user_id,resource_id,title,start_date,mode,preferred_daily_workload) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','foreign',date '2026-09-14','PACE',20)$$,'23503',null,'cross-owner resource reference rejected');
select throws_ok($$insert into resource_units(user_id,resource_id,parent_unit_id,title,sequence,unit_type) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','mixed',2,'UNIT')$$,'23503',null,'same-owner cross-resource parent rejected');
select throws_ok($$insert into plans(user_id,resource_id,goal_id,start_date,mode,preferred_daily_workload) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001',date '2026-09-14','PACE',20)$$,'23503',null,'plan must match goal resource');

select lives_ok($$insert into progress_events(id,user_id,resource_id,session_id,event_type,study_date,timezone,start_page,end_page,completed_workload,duration_minutes,idempotency_key) values ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','LEARNING',date '2026-09-14','Asia/Seoul',81,90,10,0,'80000000-0000-4000-8000-000000000001')$$,'own progress with zero minutes is valid');
select throws_ok($$insert into progress_events(user_id,resource_id,event_type,study_date,completed_workload,idempotency_key) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','LEARNING',date '2026-09-14',10,'80000000-0000-4000-8000-000000000001')$$,'23505',null,'duplicate submission rejected');
select throws_ok($$insert into progress_events(user_id,resource_id,session_id,event_type,study_date,completed_workload,idempotency_key) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000001','LEARNING',date '2026-09-14',10,gen_random_uuid())$$,'23503',null,'event cannot use another resource session');
select throws_ok($$update progress_events set completed_workload=50 where id='70000000-0000-4000-8000-000000000001'$$,'42501',null,'progress cannot be overwritten');
select throws_ok($$delete from progress_events where id='70000000-0000-4000-8000-000000000001'$$,'42501',null,'progress cannot be deleted');
select throws_ok($$update resources set initial_completed_workload=100 where id='20000000-0000-4000-8000-000000000001'$$,'23514',null,'initial progress cannot change after events');
select lives_ok($$insert into progress_events(id,user_id,resource_id,event_type,study_date,completed_workload,voids_event_id,idempotency_key) values ('70000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','VOID',date '2026-09-14',0,'70000000-0000-4000-8000-000000000001',gen_random_uuid())$$,'correction preserves original by appending VOID');
select throws_ok($$insert into progress_events(user_id,resource_id,event_type,study_date,completed_workload,voids_event_id,idempotency_key) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','VOID',date '2026-09-14',0,'70000000-0000-4000-8000-000000000001',gen_random_uuid())$$,'23505',null,'cannot void same record twice');
select throws_ok($$insert into progress_events(user_id,resource_id,event_type,study_date,completed_workload,voids_event_id,idempotency_key) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','VOID',date '2026-09-14',0,'70000000-0000-4000-8000-000000000003',gen_random_uuid())$$,'23514',null,'cannot void a VOID');

select is((select version from plans where id='50000000-0000-4000-8000-000000000001'),1::bigint,'plan starts at version one');
with changed as (update plans set forecast_date=date '2026-09-29' where id='50000000-0000-4000-8000-000000000001' and version=1 returning version) select is((select version from changed),2::bigint,'CAS advances version');
with changed as (update plans set forecast_date=date '2026-09-30' where id='50000000-0000-4000-8000-000000000001' and version=1 returning version) select is((select count(*) from changed),0::bigint,'stale expected version changes nothing');
select throws_ok($$update plans set version=99 where id='50000000-0000-4000-8000-000000000001'$$,'23514',null,'version cannot be forged');
select is((select plan_version from schedule_sessions where id='60000000-0000-4000-8000-000000000001'),1::bigint,'historical session keeps original version');
select lives_ok($$insert into replan_runs(id,user_id,resource_id,plan_id,idempotency_key,status,from_version,to_version,policy_version,reason) values ('90000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',gen_random_uuid(),'APPLIED',1,2,'test-v1','{"code":"PROGRESS_RECORDED"}')$$,'append replan audit');
select throws_ok($$update replan_runs set reason='{}' where id='90000000-0000-4000-8000-000000000001'$$,'42501',null,'replan history cannot be overwritten');
select throws_ok($$insert into replan_runs(user_id,resource_id,plan_id,idempotency_key,status,from_version,to_version,policy_version,reason) values ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',gen_random_uuid(),'APPLIED',1,2,'test-v1','{}')$$,'23505',null,'only one applied run per plan version');

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select is((select count(*) from resources),1::bigint,'Bob sees only his resource');
select is((select count(*) from progress_events),0::bigint,'Bob cannot see Alice events');
select is((select count(*) from replan_runs),0::bigint,'Bob cannot see Alice replan runs');
select throws_ok($$insert into progress_events(user_id,resource_id,event_type,study_date,completed_workload,voids_event_id,idempotency_key) values ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','VOID',date '2026-09-14',0,'70000000-0000-4000-8000-000000000001',gen_random_uuid())$$,'23503',null,'Bob cannot void Alice event');

select set_config('request.jwt.claim.sub','',true);
select is((select count(*) from resources),0::bigint,'authenticated role without subject sees no rows');
set local role anon;
select throws_ok('select * from public.resources','42501',null,'anonymous access denied');
reset role;
select * from finish();
rollback;
