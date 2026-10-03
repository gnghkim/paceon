begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values('1b000000-0000-4000-8000-000000000001','replan-speed@paceon.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000001',true);
insert into learner_profiles(user_id,timezone) values(auth.uid(),'UTC');
insert into availability_rules(user_id,iso_weekday,available_minutes) select auth.uid(),d,60 from generate_series(1,7) d;
insert into resources(id,user_id,title,type,total_pages,status) values('2b000000-0000-4000-8000-000000000001',auth.uid(),'Speed','BOOK',10,'ACTIVE');
insert into goals(id,user_id,resource_id,title,start_date,mode,preferred_daily_workload)
  values('3b000000-0000-4000-8000-000000000001',auth.uid(),'2b000000-0000-4000-8000-000000000001','Read',(now() at time zone 'UTC')::date,'PACE',10);
-- The plan was made assuming two minutes a page.
insert into plans(id,user_id,resource_id,goal_id,start_date,forecast_date,timezone,mode,preferred_daily_workload,minutes_per_page)
  values('4b000000-0000-4000-8000-000000000001',auth.uid(),'2b000000-0000-4000-8000-000000000001','3b000000-0000-4000-8000-000000000001',
    (now() at time zone 'UTC')::date,(now() at time zone 'UTC')::date+1,'UTC','PACE',10,2);

create temporary table day as select (now() at time zone 'UTC')::date as today;
create function pg_temp.replan(key text, extra jsonb, speed numeric, status text default 'ok') returns jsonb language sql as $$
  select submit_book_progress('2b000000-0000-4000-8000-000000000001',
    jsonb_build_object('kind','REPLAN','idempotencyKey',key,'planId','4b000000-0000-4000-8000-000000000001',
      'expectedPlanVersion',(select version from plans where id='4b000000-0000-4000-8000-000000000001'),
      'expectedProgressVersion',(select progress_version from resources where id='2b000000-0000-4000-8000-000000000001')) || extra,
    case when status = 'ok' then jsonb_build_object('completedThroughPage',0,'minutesPerPage',speed,'speedSource','fallback','mode','PACE','dailyPages',10,'targetDate',null,
      'schedule',jsonb_build_object('status','ok','forecastDate',(select today+1 from day),
        'replacedSessionIds',(select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from schedule_sessions where plan_id='4b000000-0000-4000-8000-000000000001'),'preservedSessions','[]'::jsonb,'reasons','[]'::jsonb,
        'sessions',jsonb_build_array(jsonb_build_object('studyDate',(select today+1 from day),'startPage',1,'endPage',10,'pages',10,'estimatedMinutes',ceil(10*speed)::integer))))
    else jsonb_build_object('completedThroughPage',0,'minutesPerPage',speed,'speedSource','fallback','mode','PACE','dailyPages',10,'targetDate',null,
      'schedule',jsonb_build_object('status','conflict','preservedSessions','[]'::jsonb,'conflicts',jsonb_build_array(jsonb_build_object('code','TIME_CAPACITY','detail','x')))) end,
    (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'study_date',x.study_date,'start_page',x.start_page,'end_page',x.end_page,
      'estimated_minutes',x.estimated_minutes,'status',x.status,'is_locked',x.is_locked,'plan_version',x.plan_version) order by x.id),'[]'::jsonb)
      from schedule_sessions x where x.plan_id='4b000000-0000-4000-8000-000000000001'),10,0,(select today from day))
$$;

-- A replan can say how fast the reader really reads.
select lives_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000001','{"minutesPerPage":0.5}',0.5)$$,'A replan carrying a reading speed is accepted');
select is((select minutes_per_page from plans where id='4b000000-0000-4000-8000-000000000001'),0.5::numeric,'and the plan keeps that speed for later replans');
select is((select estimated_minutes from schedule_sessions where plan_id='4b000000-0000-4000-8000-000000000001'),5,'The new schedule is timed with it');

-- Without a speed the plan's own speed is used, as before.
select throws_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000002','{}',2)$$,'23514','Reading speed changed','A candidate timed with an old speed is refused');
select lives_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000003','{}',0.5)$$,'A replan without a speed keeps the saved one');

-- Speeds the plan form could never produce are refused.
select throws_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000004','{"minutesPerPage":0.05}',0.05)$$,'23514','Invalid reading speed','Too fast to be real');
select throws_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000005','{"minutesPerPage":1441}',1441)$$,'23514','Invalid reading speed','Too slow to fit a day');
select throws_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000006','{"minutesPerPage":0.1234}',0.1234)$$,'23514','Invalid reading speed','More precise than a plan stores');
select throws_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000007','{"minutesPerPage":"1"}',1)$$,'23514','Invalid reading speed','A speed must be a number');

-- Only a replan may change the speed.
select throws_ok($$select submit_book_progress('2b000000-0000-4000-8000-000000000001',
  jsonb_build_object('kind','LEARNING','idempotencyKey','5b000000-0000-4000-8000-000000000008','planId','4b000000-0000-4000-8000-000000000001',
    'expectedPlanVersion',(select version from plans where id='4b000000-0000-4000-8000-000000000001'),
    'expectedProgressVersion',(select progress_version from resources where id='2b000000-0000-4000-8000-000000000001'),
    'studyDate',(select today from day),'endPage',3,'minutesPerPage',1),
  '{}'::jsonb,'[]'::jsonb,10,0,(select today from day))$$,'23514','Invalid request fields','A reading record cannot carry a speed');

-- A replan that cannot be placed changes nothing, the speed included.
select lives_ok($$select pg_temp.replan('5b000000-0000-4000-8000-000000000009','{"minutesPerPage":3}',3,'conflict')$$,'A conflicting replan is recorded as pending');
select is((select minutes_per_page from plans where id='4b000000-0000-4000-8000-000000000001'),0.5::numeric,'and leaves the saved speed alone');

reset role;
select * from finish();
rollback;
