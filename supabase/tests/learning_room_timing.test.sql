begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values('19000000-0000-4000-8000-000000000001','lr-timing@paceon.example');
insert into learning_workspaces(id,user_id,title,kind) values('29000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','Timing fixture','WRITING');
insert into learning_sessions(id,user_id,workspace_id,status,device_id,lease_expires_at,last_seen_at,last_activity_at,timezone)
values('39000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','ACTIVE',gen_random_uuid(),'2026-01-01 00:01:00+00','2026-01-01 00:00:00+00','2026-01-01 00:00:00+00','Asia/Seoul');
select learning_private.settle('19000000-0000-4000-8000-000000000001','2026-01-01 00:00:00.6+00');
select is((select elapsed_seconds from learning_sessions where id='39000000-0000-4000-8000-000000000001'),0,'Subsecond elapsed remains integer zero before a full second');
select learning_private.settle('19000000-0000-4000-8000-000000000001','2026-01-01 00:00:01.2+00');
select is((select elapsed_seconds from learning_sessions where id='39000000-0000-4000-8000-000000000001'),1,'Repeated fractional intervals accumulate a whole second');
select learning_private.settle('19000000-0000-4000-8000-000000000001','2026-01-01 00:00:01.8+00');
select learning_private.settle('19000000-0000-4000-8000-000000000001','2026-01-01 00:00:02.4+00');
select is((select elapsed_seconds from learning_sessions where id='39000000-0000-4000-8000-000000000001'),2,'Fractional remainder survives multiple settlements');
update learning_sessions set status='PAUSED',pause_reason='MANUAL' where id='39000000-0000-4000-8000-000000000001';
select learning_private.settle('19000000-0000-4000-8000-000000000001','2026-01-01 00:05:02.4+00');
select is((select elapsed_seconds from learning_sessions where id='39000000-0000-4000-8000-000000000001'),2,'Paused time adds no fractional or whole seconds');
insert into learning_ai_jobs(id,user_id,workspace_id,kind,status,input,attempts,lease_token,lease_expires_at,created_at) values
('49000000-0000-4000-8000-000000000001','19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','STUDY_SUMMARY','RUNNING','{}',3,gen_random_uuid(),clock_timestamp()-interval '1 minute','-infinity'),
('49000000-0000-4000-8000-000000000002','19000000-0000-4000-8000-000000000001','29000000-0000-4000-8000-000000000001','STUDY_SUMMARY','QUEUED','{}',0,null,null,'-infinity');
-- Model a delay inside exhausted-job cleanup; lease allocation must use time after it completes.
create function pg_temp.learning_cleanup_delay() returns trigger language plpgsql as $$
begin
 if old.id='49000000-0000-4000-8000-000000000001' and new.status='FAILED' then perform pg_sleep(0.3); end if;
 return new;
end;
$$;
create trigger learning_cleanup_delay before update on learning_ai_jobs for each row execute function pg_temp.learning_cleanup_delay();
create temporary table timing_claim as select claim_learning_job() v;
select is((select v->>'id' from timing_claim),'49000000-0000-4000-8000-000000000002','Claim skips the exhausted job');
select ok((select (v->>'lease_expires_at')::timestamptz from timing_claim)>clock_timestamp()+interval '179.85 seconds','Claim lease begins after slow cleanup, not before it');
select is((select status from learning_ai_jobs where id='49000000-0000-4000-8000-000000000001'),'FAILED','Exhausted job finalized during claim');
select * from finish();
rollback;
