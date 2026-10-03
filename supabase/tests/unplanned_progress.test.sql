begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select has_function('public','submit_unplanned_book_progress',array['uuid','jsonb','integer','numeric','date']);
select ok(not has_function_privilege('anon','public.submit_unplanned_book_progress(uuid,jsonb,integer,numeric,date)','execute'),'Anonymous cannot record');
select is((select prosecdef from pg_proc where oid='public.submit_unplanned_book_progress(uuid,jsonb,integer,numeric,date)'::regprocedure),false,'Caller RLS is preserved');
select throws_ok($$select public.submit_unplanned_book_progress('00000000-0000-0000-0000-000000000000','{}',100,0,current_date)$$,'42501','Authentication required','Anonymous caller rejected');

insert into auth.users(id,email) values
  ('1a000000-0000-4000-8000-000000000001','unplanned-a@paceon.example'),
  ('1a000000-0000-4000-8000-000000000002','unplanned-b@paceon.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);
insert into learner_profiles(user_id,timezone) values(auth.uid(),'UTC');
-- A book added with the first ten pages already read, and no plan yet.
insert into resources(id,user_id,title,type,total_pages,initial_completed_workload,status)
  values('2a000000-0000-4000-8000-000000000001',auth.uid(),'Read before planning','BOOK',100,10,'ACTIVE');

create temporary table today as select (now() at time zone 'UTC')::date as d;
create function pg_temp.request(kind text, key text, version integer, end_page integer, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('kind',kind,'idempotencyKey',key,'expectedProgressVersion',version,
    'studyDate',(select d from today),'endPage',end_page,'durationMinutes',25,'memo','') || extra
$$;

-- Reading without a plan is recorded and moves the progress on.
create temporary table first_result as select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000001',0,30),100,10,(select d from today)) result;
select is((select result->>'completedThroughPage' from first_result),'30','The reading moves progress to the last page read');
select is((select result->>'unplanned' from first_result),'true','The answer says no schedule was touched');
select is((select result->>'replanStatus' from first_result),'applied','and nothing waits for a replan');
select ok((select result->'planVersion' = 'null'::jsonb from first_result),'There is no plan version to report');
select is((select count(*) from progress_events where resource_id='2a000000-0000-4000-8000-000000000001' and event_type='LEARNING' and start_page=11 and end_page=30 and duration_minutes=25 and timezone='UTC'),1::bigint,'One learning event from the next unread page, with the measured time');
select is((select progress_version from resources where id='2a000000-0000-4000-8000-000000000001'),1::bigint,'The progress revision advances');
select is((select count(*) from schedule_sessions where resource_id='2a000000-0000-4000-8000-000000000001'),0::bigint,'No schedule appears');

-- A retry is answered from the ledger, a reused key with other content is refused.
select is(submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000001',0,30),100,10,(select d from today)),
  (select result from first_result),'The same request returns the stored answer');
select is((select count(*) from progress_events where resource_id='2a000000-0000-4000-8000-000000000001'),1::bigint,'and records nothing twice');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000001',0,31),100,10,(select d from today))$$,
  '40001','Idempotency key reused','A reused key with a different page is refused');

-- Stale or impossible requests change nothing.
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000002',0,40),100,10,(select d from today))$$,
  '40001','Progress state changed','A request made from an old revision is refused');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000003',1,30),100,10,(select d from today))$$,
  '23514','Invalid actual page range','Reading must move past the pages already read');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000004',1,101),100,10,(select d from today))$$,
  '23514','Invalid actual page range','Reading cannot pass the last page');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000005',1,40,jsonb_build_object('studyDate',(select d+1 from today))),100,10,(select d from today))$$,
  '23514','Invalid progress request','A future day cannot be recorded');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000006',1,40),100,10,(select d+1 from today))$$,
  '23514','Invalid progress request','The day the client calls today must be today where the reader lives');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000007',1,40,'{"planId":"4a000000-0000-4000-8000-000000000001"}'),100,10,(select d from today))$$,
  '23514','Invalid progress request','Fields that belong to a planned record are refused');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('REVIEW','3a000000-0000-4000-8000-000000000008',1,40),100,10,(select d from today))$$,
  '23514','Invalid progress request','Only reading and its correction are recorded without a plan');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000009',1,40,'{"endPage":40.5}'),100,10,(select d from today))$$,
  '23514','Invalid progress request','Pages are whole numbers');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-00000000000a',1,40),200,10,(select d from today))$$,
  '40001','Progress state changed','A changed page count is caught');
select is((select count(*) from progress_events where resource_id='2a000000-0000-4000-8000-000000000001'),1::bigint,'None of the refused requests left a trace');

-- The latest reading can be corrected, and withdrawn altogether.
select is((submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('CORRECTION','3a000000-0000-4000-8000-00000000000b',1,25,
    jsonb_build_object('eventId',(select id from progress_events where resource_id='2a000000-0000-4000-8000-000000000001' and event_type='LEARNING'))),
  100,10,(select d from today)))->>'completedThroughPage','25','A correction replaces the latest reading');
select is((select count(*) from progress_events where resource_id='2a000000-0000-4000-8000-000000000001' and event_type='VOID'),1::bigint,'The original is voided, not deleted');
select is((select count(*) from progress_events e where resource_id='2a000000-0000-4000-8000-000000000001' and event_type='LEARNING'
  and not exists(select 1 from progress_events v where v.voids_event_id=e.id) and start_page=11 and end_page=25),1::bigint,'and the replacement starts where the original did');
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('CORRECTION','3a000000-0000-4000-8000-00000000000c',2,20,'{"eventId":"5a000000-0000-4000-8000-000000000001"}'),100,10,(select d from today))$$,
  '23514','Only latest learning can be corrected','Only the latest reading can be corrected');

-- Reading to the end finishes the book; a slip of the finger can still be taken back.
select is((submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-00000000000d',2,100),100,10,(select d from today)))->>'completedThroughPage','100','Reading to the last page');
select is((select status::text from resources where id='2a000000-0000-4000-8000-000000000001'),'COMPLETED','finishes the book');
select is((submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('CORRECTION','3a000000-0000-4000-8000-00000000000e',3,40,
    jsonb_build_object('eventId',(select e.id from progress_events e where e.resource_id='2a000000-0000-4000-8000-000000000001' and e.event_type='LEARNING' and e.end_page=100))),
  100,10,(select d from today)))->>'completedThroughPage','40','A mistyped last page can be corrected');
select is((select status::text from resources where id='2a000000-0000-4000-8000-000000000001'),'ACTIVE','and the book is open again');

-- Someone else's book is out of reach.
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000002',true);
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-00000000000f',4,50),100,10,(select d from today))$$,
  '42501','Book not found','Another reader cannot record on this book');
select set_config('request.jwt.claim.sub','1a000000-0000-4000-8000-000000000001',true);

-- A plan made afterwards starts from the page already reached.
select throws_ok($$select create_initial_book_plan('2a000000-0000-4000-8000-000000000001',100,10,
  jsonb_build_object('startDate',(select d from today),'timezone','UTC','mode','PACE','dailyPages',90,'minutesPerPage',1,
    'availability',jsonb_build_array(jsonb_build_object('isoWeekday',1,'availableMinutes',120),jsonb_build_object('isoWeekday',2,'availableMinutes',120),
      jsonb_build_object('isoWeekday',3,'availableMinutes',120),jsonb_build_object('isoWeekday',4,'availableMinutes',120),jsonb_build_object('isoWeekday',5,'availableMinutes',120),
      jsonb_build_object('isoWeekday',6,'availableMinutes',120),jsonb_build_object('isoWeekday',7,'availableMinutes',120))),
  jsonb_build_array(jsonb_build_object('studyDate',(select d from today),'startPage',11,'endPage',100)),(select d from today))$$,
  '23514','Book state changed','A plan that ignores the pages already read is refused');
select lives_ok($$select create_initial_book_plan('2a000000-0000-4000-8000-000000000001',100,40,
  jsonb_build_object('startDate',(select d from today),'timezone','UTC','mode','PACE','dailyPages',60,'minutesPerPage',1,
    'availability',jsonb_build_array(jsonb_build_object('isoWeekday',1,'availableMinutes',120),jsonb_build_object('isoWeekday',2,'availableMinutes',120),
      jsonb_build_object('isoWeekday',3,'availableMinutes',120),jsonb_build_object('isoWeekday',4,'availableMinutes',120),jsonb_build_object('isoWeekday',5,'availableMinutes',120),
      jsonb_build_object('isoWeekday',6,'availableMinutes',120),jsonb_build_object('isoWeekday',7,'availableMinutes',120))),
  jsonb_build_array(jsonb_build_object('studyDate',(select d from today),'startPage',41,'endPage',100)),(select d from today))$$,
  'A plan from the next unread page is accepted');
select is((select start_page from schedule_sessions where resource_id='2a000000-0000-4000-8000-000000000001'),41,'Its first session starts after the pages already read');

-- Once there is a plan, recording goes through the plan so its schedule stays true.
select throws_ok($$select submit_unplanned_book_progress('2a000000-0000-4000-8000-000000000001',
  pg_temp.request('LEARNING','3a000000-0000-4000-8000-000000000010',4,50),100,10,(select d from today))$$,
  '40001','Progress state changed','A planned book cannot bypass its schedule');

reset role;
select lives_ok($$delete from auth.users where id in ('1a000000-0000-4000-8000-000000000001','1a000000-0000-4000-8000-000000000002')$$,'Account cleanup still cascades');
select * from finish();
rollback;
