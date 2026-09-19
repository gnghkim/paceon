begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
  ('c7000000-0000-4000-8000-000000000001','units-a@paceon.example'),
  ('c7000000-0000-4000-8000-000000000002','units-b@paceon.example');
-- 60 minutes every day for the first reader; nothing for the second.
insert into public.availability_rules(user_id,iso_weekday,available_minutes)
  select 'c7000000-0000-4000-8000-000000000001', n, 60 from generate_series(1,7) n;

set local role authenticated;
select set_config('request.jwt.claim.sub','c7000000-0000-4000-8000-000000000001',true);

-- ---- creating a material ----
create temp table made as
  select public.create_unit_material('{
    "title":"Basic Grammar in Use","kind":"TEXTBOOK","unitLabel":"Unit",
    "units":[{"title":"Present","section":true},
             {"title":"Unit 1 am/is/are"},{"title":"Unit 2 questions"},{"title":"Unit 3 doing"},
             {"title":"Past","section":true},
             {"title":"Unit 4 was/were","minutes":40},{"title":"Unit 5 worked"},{"title":"Unit 6 long","minutes":90}]}'::jsonb) as id;
grant select on made to authenticated;

select is((select workload_unit::text from resources where id=(select id from made)), 'UNIT', 'The material counts in units');
select is((select total_units from resources where id=(select id from made)), 6, 'Section headings are not counted as units');
select is((select unit_label from resources where id=(select id from made)), 'Unit', 'The reader''s word for a unit is kept');
select is((select count(*) from resource_units where resource_id=(select id from made) and unit_type='SECTION'), 2::bigint, 'Sections are stored as headings');
select is(
  (select p.title from resource_units u join resource_units p on p.id=u.parent_unit_id where u.resource_id=(select id from made) and u.title='Unit 5 worked'),
  'Past', 'A unit belongs to the section above it');

select throws_ok($$select public.create_unit_material('{"title":"x","kind":"TEXTBOOK","unitLabel":"Unit","units":[{"title":"only a heading","section":true}]}'::jsonb)$$,
  '23514', null, 'A material with headings but no units is rejected');
select throws_ok($$select public.create_unit_material('{"title":"x","kind":"NOVEL","unitLabel":"Unit","units":[{"title":"a"}]}'::jsonb)$$,
  '23514', null, 'An unknown kind is rejected');
select throws_ok($$select public.create_unit_material('{"title":"x","kind":"COURSE","unitLabel":"강","units":[{"title":"a","minutes":0}]}'::jsonb)$$,
  '23514', null, 'A unit of zero minutes is rejected');
select throws_ok($$select public.create_unit_material('{"title":"x","kind":"COURSE","unitLabel":"강","units":[{"title":"a","minutes":12.5}]}'::jsonb)$$,
  '23514', null, 'Fractional minutes are rejected');

-- ---- planning ----
-- Two a day, 25 minutes each unless the unit says otherwise.
create temp table planned as
  select public.plan_unit_material((select id from made), '{"dailyUnits":2,"minutesPerUnit":25,"timezone":"Asia/Seoul"}'::jsonb) as r;
grant select on planned to authenticated;
select is((select r->>'status' from planned), 'ok', 'A plan is made and filled');
select is((select count(*) from schedule_sessions where resource_id=(select id from made)), 6::bigint, 'Every unit gets one session');
select is((select count(*) from schedule_sessions s where s.resource_id=(select id from made) and s.unit_id is null), 0::bigint, 'Each session names its unit');

create temp view plan_days as
  select u.title, s.study_date - (now() at time zone 'Asia/Seoul')::date as day_offset, s.estimated_minutes, s.status::text
  from schedule_sessions s join resource_units u on u.id=s.unit_id
  where s.resource_id=(select id from made) order by u.sequence;

-- day 0: Unit1(25)+Unit2(25)=50 of 60. day 1: Unit3(25), then Unit4 is 40 and does not fit with it (65>60)
-- so it waits; order is kept, so Unit5 waits behind it. day 2: Unit4(40). Unit5(25) would make 65, so day 3.
-- Unit6 is 90 minutes, longer than any day: it sits alone on an empty day, booked for the day's 60.
select results_eq(
  $$select title, day_offset, estimated_minutes from plan_days$$,
  $$values ('Unit 1 am/is/are',0,25),('Unit 2 questions',0,25),('Unit 3 doing',1,25),
           ('Unit 4 was/were',2,40),('Unit 5 worked',3,25),('Unit 6 long',4,60)$$,
  'Units fill days in order, within the daily count and the time free that day');
select is((select (r->>'forecastDate')::date - (now() at time zone 'Asia/Seoul')::date from planned), 4, 'The forecast is the last day used');
select ok((select max(total) <= 60 from (select sum(estimated_minutes) total from schedule_sessions where user_id='c7000000-0000-4000-8000-000000000001' group by study_date) d),
  'No day is booked past the time available, even for a unit too long to fit');

-- ---- studying out of order ----
-- The reader picks Unit 5 today although it is scheduled three days out.
create temp table picked as
  select public.submit_unit_progress((select id from made), jsonb_build_object(
    'kind','COMPLETE','unitId',(select id from resource_units where title='Unit 5 worked'),
    'idempotencyKey','cb000000-0000-4000-8000-000000000001','durationMinutes',30,'memo','과거형 규칙 동사')) as r;
grant select on picked to authenticated;
select is((select r->>'done' from picked), '1', 'One unit is done');
select is((select count(*) from schedule_sessions s join resource_units u on u.id=s.unit_id
           where s.resource_id=(select id from made) and u.title='Unit 5 worked' and s.study_date > (now() at time zone 'Asia/Seoul')::date), 0::bigint,
  'A unit studied early drops out of the days ahead');
select results_eq(
  $$select title, day_offset from plan_days where day_offset > 0$$,
  $$values ('Unit 3 doing',1),('Unit 4 was/were',2),('Unit 6 long',3)$$,
  'The rest close up behind it, still in order');
select is((select memo from progress_events where unit_id=(select id from resource_units where title='Unit 5 worked') and event_type='LEARNING'),
  '과거형 규칙 동사', 'What was studied is kept with the unit');
-- Today's sessions are today's promise and stay where they are.
select is((select count(*) from plan_days where day_offset = 0), 2::bigint, 'Today is left alone');

select throws_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE',
     'unitId',(select id from resource_units where title='Unit 5 worked'),'idempotencyKey','cb000000-0000-4000-8000-000000000002'))$$,
  '23505', null, 'A finished unit cannot be finished again');

-- The same request sent twice gives the same answer and writes nothing new.
select is(
  (select public.submit_unit_progress((select id from made), jsonb_build_object(
    'kind','COMPLETE','unitId',(select id from resource_units where title='Unit 5 worked'),
    'idempotencyKey','cb000000-0000-4000-8000-000000000001','durationMinutes',30,'memo','과거형 규칙 동사'))),
  (select r from picked), 'A retried request returns the first answer');
select is((select count(*) from progress_events where resource_id=(select id from made)), 1::bigint, 'and records nothing twice');

-- ---- repeating ----
select lives_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','REPEAT',
     'unitId',(select id from resource_units where title='Unit 5 worked'),'idempotencyKey','cb000000-0000-4000-8000-000000000003','durationMinutes',15))$$,
  'A finished unit can be studied again');
select is((select count(*) from progress_events where unit_id=(select id from resource_units where title='Unit 5 worked') and event_type='REVIEW'), 1::bigint, 'Repeating is kept as a review');
select results_eq($$select title, day_offset from plan_days where day_offset > 0$$,
  $$values ('Unit 3 doing',1),('Unit 4 was/were',2),('Unit 6 long',3)$$, 'Repeating does not move the schedule');
select throws_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','REPEAT',
     'unitId',(select id from resource_units where title='Unit 3 doing'),'idempotencyKey','cb000000-0000-4000-8000-000000000004'))$$,
  '23514', null, 'A unit not yet studied cannot be repeated');

-- ---- undoing ----
select lives_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','UNDO',
     'unitId',(select id from resource_units where title='Unit 5 worked'),'idempotencyKey','cb000000-0000-4000-8000-000000000005'))$$,
  'Finishing can be undone');
select is((select count(*) from progress_events where resource_id=(select id from made) and event_type='LEARNING'), 1::bigint, 'The original record is kept, not deleted');
select results_eq($$select title, day_offset from plan_days where day_offset > 0$$,
  $$values ('Unit 3 doing',1),('Unit 4 was/were',2),('Unit 5 worked',3),('Unit 6 long',4)$$,
  'An undone unit returns to its place in order');
select lives_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE',
     'unitId',(select id from resource_units where title='Unit 5 worked'),'idempotencyKey','cb000000-0000-4000-8000-000000000006'))$$,
  'and can be finished again afterwards');

-- ---- bad requests ----
select throws_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE',
     'unitId',(select id from resource_units where title='Past'),'idempotencyKey','cb000000-0000-4000-8000-000000000007'))$$,
  '42501', null, 'A section heading cannot be studied');
select throws_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE',
     'unitId',(select id from resource_units where title='Unit 3 doing'),'idempotencyKey','cb000000-0000-4000-8000-000000000008',
     'studyDate',((now() at time zone 'Asia/Seoul')::date + 1)::text))$$,
  '23514', null, 'Study cannot be recorded for tomorrow');
select throws_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE',
     'unitId',(select id from resource_units where title='Unit 3 doing'),'idempotencyKey','cb000000-0000-4000-8000-000000000009','score',90))$$,
  '23514', null, 'Unknown fields are rejected');

-- ---- changing the pace ----
select lives_ok($$select public.plan_unit_material((select id from made), '{"dailyUnits":1,"minutesPerUnit":25}'::jsonb)$$, 'The daily count can be changed');
select ok((select max(n) = 1 from (select count(*) n from plan_days where day_offset > 0 group by day_offset) d), 'The days ahead are refilled at the new count');
select is((select count(*) from plans where resource_id=(select id from made)), 1::bigint, 'Changing the pace does not make a second plan');

-- ---- finishing everything ----
do $$
declare u record; n integer := 20;
begin
  for u in select id from public.resource_units where resource_id=(select id from made) and unit_type<>'SECTION'
           and not exists (select 1 from public.progress_events e where e.unit_id=resource_units.id and e.event_type='LEARNING'
                           and not exists (select 1 from public.progress_events v where v.voids_event_id=e.id)) loop
    n := n + 1;
    perform public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE','unitId',u.id,
      'idempotencyKey',('cb000000-0000-4000-8000-0000000000'||n)::uuid));
  end loop;
end $$;
select is((select status::text from plans where resource_id=(select id from made)), 'COMPLETED', 'The plan completes when every unit is done');
select is((select status::text from resources where id=(select id from made)), 'COMPLETED', 'and so does the material');
select is((select count(*) from schedule_sessions where resource_id=(select id from made) and study_date > (now() at time zone 'Asia/Seoul')::date), 0::bigint, 'Nothing is left in the days ahead');

-- ---- sharing the day with a book ----
reset role;
insert into public.resources(id,user_id,title,type,total_pages) values ('c8000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','A book','BOOK',100);
insert into public.goals(id,user_id,resource_id,title,start_date,mode,preferred_daily_workload) values ('c9000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','A book',(now() at time zone 'Asia/Seoul')::date,'PACE',20);
insert into public.plans(id,user_id,resource_id,goal_id,mode,start_date,preferred_daily_workload) values ('ca000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','c9000000-0000-4000-8000-000000000001','PACE',(now() at time zone 'Asia/Seoul')::date,20);
-- The book holds 50 of tomorrow's 60 minutes.
insert into public.schedule_sessions(user_id,resource_id,plan_id,study_date,planned_workload,start_page,end_page,estimated_minutes)
  values ('c7000000-0000-4000-8000-000000000001','c8000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Seoul')::date + 1,20,1,20,50);
set local role authenticated;
select set_config('request.jwt.claim.sub','c7000000-0000-4000-8000-000000000001',true);
create temp table second as
  select public.create_unit_material('{"title":"Course","kind":"COURSE","unitLabel":"강","units":[{"title":"1강","minutes":30},{"title":"2강","minutes":30},{"title":"3강","minutes":30}]}'::jsonb) as id;
grant select on second to authenticated;
select public.plan_unit_material((select id from second), '{"dailyUnits":3,"minutesPerUnit":30}'::jsonb);
select results_eq(
  $$select u.title, s.study_date - (now() at time zone 'Asia/Seoul')::date from schedule_sessions s join resource_units u on u.id=s.unit_id
    where s.resource_id=(select id from second) order by u.sequence$$,
  $$values ('1강',0),('2강',0),('3강',2)$$,
  'Units go around the time a book already holds');
select is((select unit_type::text from resource_units where resource_id=(select id from second) limit 1), 'LECTURE', 'A course''s units are lectures');

-- ---- no time at all ----
select set_config('request.jwt.claim.sub','c7000000-0000-4000-8000-000000000002',true);
create temp table third as select public.create_unit_material('{"title":"No time","kind":"COURSE","unitLabel":"강","units":[{"title":"1강"}]}'::jsonb) as id;
grant select on third to authenticated;
select throws_ok($$select public.plan_unit_material((select id from third), '{"dailyUnits":1,"minutesPerUnit":30}'::jsonb)$$,
  'P0001', null, 'A plan that cannot be filled is refused');
select is((select count(*) from plans where resource_id=(select id from third)), 0::bigint, 'and leaves no half-made plan behind');

-- ---- privacy ----
select is((select count(*) from resource_units where resource_id=(select id from made)), 0::bigint, 'Another reader sees none of the units');
select throws_ok($$select public.replan_unit_plan((select id from made))$$, '42501', null, 'and cannot replan the material');
select throws_ok(
  $$select public.submit_unit_progress((select id from made), jsonb_build_object('kind','COMPLETE','unitId','c7000000-0000-4000-8000-00000000ffff','idempotencyKey','cb000000-0000-4000-8000-0000000000aa'))$$,
  '42501', null, 'nor record progress on it');

set local role anon;
select throws_ok($$select public.create_unit_material('{}'::jsonb)$$, '42501', null, 'Signed-out callers cannot create materials');

select * from finish();
rollback;
