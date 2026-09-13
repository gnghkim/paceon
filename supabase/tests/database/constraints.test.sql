begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();
insert into auth.users(id,email) values ('11000000-0000-4000-8000-000000000001','constraints@paceon.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);

select throws_ok($$insert into resources(user_id,title,type,total_pages) values ('11000000-0000-4000-8000-000000000001',' ','BOOK',20)$$,'23514',null,'blank titles rejected');
select throws_ok($$insert into resources(user_id,title,type,total_pages) values ('11000000-0000-4000-8000-000000000001','Book','BOOK',0)$$,'23514',null,'zero page count rejected');
select throws_ok($$insert into resources(user_id,title,type,total_pages,initial_completed_workload) values ('11000000-0000-4000-8000-000000000001','Book','BOOK',20,21)$$,'23514',null,'initial progress cannot exceed total');
select throws_ok($$insert into learner_profiles(user_id,timezone) values ('11000000-0000-4000-8000-000000000001','Mars/Olympus')$$,'23514',null,'invalid timezone rejected');
select throws_ok($$insert into availability_rules(user_id,iso_weekday,available_minutes) values ('11000000-0000-4000-8000-000000000001',0,30)$$,'23514',null,'ISO weekday starts at one');
select throws_ok($$insert into availability_rules(user_id,iso_weekday,available_minutes) values ('11000000-0000-4000-8000-000000000001',1,1441)$$,'23514',null,'daily budget bounded by one day');
insert into resources(id,user_id,title,type,total_pages) values ('21000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Book','BOOK',100);
select throws_ok($$insert into resource_units(user_id,resource_id,title,sequence,unit_type,start_page,end_page) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Bad range',1,'CHAPTER',20,10)$$,'23514',null,'reversed range rejected');
select throws_ok($$insert into resource_units(user_id,resource_id,title,sequence,unit_type,start_page,end_page) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Bad range',1,'CHAPTER',1,101)$$,'23514',null,'range beyond resource rejected');
insert into resource_units(id,user_id,resource_id,title,sequence,unit_type,start_page,end_page) values ('31000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Parent',1,'CHAPTER',1,20);
insert into resource_units(id,user_id,resource_id,parent_unit_id,title,sequence,unit_type) values ('31000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000001','Child',2,'SECTION');
select throws_ok($$update resource_units set parent_unit_id='31000000-0000-4000-8000-000000000002' where id='31000000-0000-4000-8000-000000000001'$$,'23514',null,'multi-level parent cycle rejected');
select throws_ok($$update resources set total_pages=10 where id='21000000-0000-4000-8000-000000000001'$$,'23514',null,'metadata cannot invalidate existing ranges');
select throws_ok($$update resources set type='CUSTOM',workload_unit='MINUTE' where id='21000000-0000-4000-8000-000000000001'$$,'23514',null,'unit changes cannot invalidate existing page children');
-- Multi-row forward references must be checked against the final statement state.
select throws_ok($$insert into resource_units(id,user_id,resource_id,parent_unit_id,title,sequence,unit_type) values
('31000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000011','Cycle A',10,'UNIT'),
('31000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000010','Cycle B',11,'UNIT')$$,'23514',null,'bulk forward-reference cycle rejected');
select throws_ok($$insert into goals(user_id,resource_id,title,start_date,mode) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Deadline',date '2026-09-14','DEADLINE')$$,'23514',null,'Deadline requires target date');
select throws_ok($$insert into goals(user_id,resource_id,title,start_date,mode,preferred_daily_workload) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Pace',date '2026-09-14','PACE','NaN')$$,'23514',null,'non-finite workload rejected');
insert into goals(id,user_id,resource_id,title,start_date,mode,preferred_daily_workload) values ('41000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','Pace',date '2026-09-14','PACE',20);
insert into plans(id,user_id,resource_id,goal_id,start_date,mode,preferred_daily_workload) values ('51000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001',date '2026-09-14','PACE',20);
select throws_ok($$insert into schedule_sessions(user_id,resource_id,plan_id,study_date,planned_workload,start_page,end_page) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',date '2026-09-14',10,1,20)$$,'23514',null,'session workload must equal inclusive page range');
select throws_ok($$insert into schedule_sessions(user_id,resource_id,plan_id,plan_version,study_date,planned_workload) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001',2,date '2026-09-14',20)$$,'23514',null,'future plan version rejected');
select throws_ok($$insert into progress_events(user_id,resource_id,study_date,completed_workload,duration_minutes,idempotency_key) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',date '2026-09-14',20,-1,gen_random_uuid())$$,'23514',null,'negative duration rejected');
select throws_ok($$insert into progress_events(user_id,resource_id,study_date,completed_workload,started_at,completed_at,idempotency_key) values ('11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',date '2026-09-14',20,'2026-09-14T01:00Z','2026-09-14T00:00Z',gen_random_uuid())$$,'23514',null,'reversed timestamps rejected');
insert into progress_events(id,user_id,resource_id,study_date,timezone,completed_workload,completed_at,idempotency_key) values ('71000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001',date '2026-09-14','Asia/Seoul',20,'2026-09-13T16:00Z',gen_random_uuid());
select is((select study_date from progress_events where id='71000000-0000-4000-8000-000000000001'),date '2026-09-14','local study date remains distinct from UTC date');
select is((select completed_at at time zone 'UTC' from progress_events where id='71000000-0000-4000-8000-000000000001'),timestamp '2026-09-13 16:00:00','absolute time preserved');
select throws_ok($$insert into progress_events(id,user_id,resource_id,event_type,study_date,completed_workload,voids_event_id,idempotency_key) values
('71000000-0000-4000-8000-000000000010','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','VOID',date '2026-09-14',0,'71000000-0000-4000-8000-000000000011',gen_random_uuid()),
('71000000-0000-4000-8000-000000000011','11000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','VOID',date '2026-09-14',0,'71000000-0000-4000-8000-000000000001',gen_random_uuid())$$,'23514',null,'bulk forward reference cannot void a VOID');
select throws_ok($$delete from resources where id='21000000-0000-4000-8000-000000000001'$$,'23503',null,'resource deletion cannot erase learning history');

reset role;
-- Trusted Auth account deletion can still remove all owned data.
select lives_ok($$delete from auth.users where id='11000000-0000-4000-8000-000000000001'$$,'account deletion cascades consistently');
select is((select count(*) from progress_events where user_id='11000000-0000-4000-8000-000000000001'),0::bigint,'account deletion removes its events');
select * from finish();
rollback;
