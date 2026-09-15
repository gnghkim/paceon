-- Regression: 20260921000000_youtube_connections.sql revoked schema-level USAGE on
-- `private` (intending only to lock down the new private.youtube_connections table),
-- which silently broke every SECURITY INVOKER function that references `private.*`
-- by qualified name, e.g. create_initial_book_plan calling private.valid_timezone().
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select ok(has_schema_privilege('authenticated','private','USAGE'),'authenticated keeps USAGE on schema private for invoker-rights functions');
select ok(has_schema_privilege('service_role','private','USAGE'),'service_role keeps USAGE on schema private');
select ok(not has_schema_privilege('anon','private','USAGE'),'anon still has no access to schema private');
select ok(not has_table_privilege('authenticated','private.youtube_connections','SELECT'),'the youtube_connections table-level lockdown is untouched');

insert into auth.users(id,email) values('50000000-0000-4000-8000-000000000001','private-usage@paceon.example');
insert into resources(id,user_id,title,type,workload_unit,source,total_pages,initial_completed_workload) values
 ('51000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Private usage book','BOOK','PAGE','MANUAL',100,10);
set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);
-- A single session covers the whole remaining 90 pages (11..100) on start_day itself,
-- so it is also the plan's forecast date; every weekday gets enough capacity for it
-- regardless of which weekday "current_date+1" happens to be when this test runs.
select lives_ok(
 $$select create_initial_book_plan('51000000-0000-4000-8000-000000000001',100,10,
   jsonb_build_object('mode','PACE','startDate',to_char(current_date+1,'YYYY-MM-DD'),'timezone','Asia/Seoul','dailyPages',10,'minutesPerPage',1,
     'availability',(select jsonb_agg(jsonb_build_object('isoWeekday',d,'availableMinutes',100)) from generate_series(1,7) d)),
   jsonb_build_array(jsonb_build_object('studyDate',to_char(current_date+1,'YYYY-MM-DD'),'startPage',11,'endPage',100)),
   current_date+1)$$,
 'An authenticated owner can create an initial book plan end to end (permission denied for schema private is exactly the prior regression)'
);
reset role;
select * from finish();
rollback;
