begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_function('public','learning_daily_minutes',array['date','date'],'Daily minutes RPC exists');

insert into auth.users(id,email) values
 ('40000000-0000-4000-8000-000000000001','heatmap-owner@paceon.example'),
 ('40000000-0000-4000-8000-000000000002','heatmap-other@paceon.example');
insert into learning_workspaces(id,user_id,title,kind) values
 ('41000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','Owner room','WRITING'),
 ('41000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','Other room','WRITING');
insert into learning_sessions(id,user_id,workspace_id,status,device_id,lease_expires_at,last_seen_at,last_activity_at,timezone,ended_at) values
 ('42000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','ENDED',gen_random_uuid(),'2026-09-13 15:30:00+00','2026-09-13 15:30:00+00','2026-09-13 15:30:00+00','Asia/Seoul','2026-09-13 15:30:00+00'),
 ('42000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','ENDED',gen_random_uuid(),'2026-09-10 05:00:00+00','2026-09-10 05:00:00+00','2026-09-10 05:00:00+00','America/New_York','2026-09-10 05:00:00+00'),
 ('42000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','ENDED',gen_random_uuid(),'2026-01-01 00:10:00+00','2026-01-01 00:10:00+00','2026-01-01 00:10:00+00','Asia/Seoul','2026-01-01 00:10:00+00'),
 ('42000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000002','ENDED',gen_random_uuid(),'2026-09-13 15:00:00+00','2026-09-13 15:00:00+00','2026-09-13 15:00:00+00','Asia/Seoul','2026-09-13 15:00:00+00');
-- Midnight crossing in Asia/Seoul: 23:50~00:30 KST = 14:50~15:30 UTC, split 10min/30min across the two local dates.
insert into learning_private.activity_segments(session_id,user_id,started_at,ended_at,timezone) values
 ('42000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','2026-09-13T14:50:00+00','2026-09-13T15:30:00+00','Asia/Seoul'),
 -- Single local day in America/New_York (EDT, UTC-4): 04:00~05:00 UTC = 00:00~01:00 local, no split.
 ('42000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000001','2026-09-10T04:00:00+00','2026-09-10T05:00:00+00','America/New_York'),
 -- Outside the queried range below; must never appear.
 ('42000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000001','2026-01-01T00:00:00+00','2026-01-01T00:10:00+00','Asia/Seoul'),
 -- Belongs to the other user, fully inside one local day; must never leak into owner's totals.
 ('42000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','2026-09-13T13:00:00+00','2026-09-13T14:00:00+00','Asia/Seoul');

set local role authenticated;
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
select is((select minutes from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-09-13'),10::numeric,'Midnight-crossing segment credits 10 minutes to the earlier local date');
select is((select minutes from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-09-14'),30::numeric,'Midnight-crossing segment credits 30 minutes to the later local date');
select is((select minutes from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-09-10'),60::numeric,'A same-day segment in a different stored timezone is not split');
select is((select count(*) from learning_daily_minutes('2026-09-01','2026-09-30') where study_date='2026-01-01'),0::bigint,'A segment outside the requested range is excluded');
select is((select count(*) from learning_daily_minutes('2026-09-01','2026-09-30')),3::bigint,'Only the three in-range owner dates are returned');
select is((select count(*) from learning_daily_minutes('2026-09-14','2026-09-01')),0::bigint,'A reversed range returns nothing');
select is((select count(*) from learning_daily_minutes('2020-01-01','2026-12-31')),0::bigint,'A range spanning more than 366 days returns nothing');
select set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
select is((select count(*) from learning_daily_minutes('2026-09-01','2026-09-30') where study_date in ('2026-09-13','2026-09-14')),1::bigint,'Other user only sees their own single-day total, none of the owner''s split minutes');
reset role;
set local role anon;
select throws_ok($$select * from learning_daily_minutes('2026-09-01','2026-09-30')$$,'42501',null,'Anonymous role cannot call the RPC');
reset role;
select * from finish();
rollback;
