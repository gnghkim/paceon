begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select has_column('public'::name,'resources'::name,'reading_started_at'::name,'Books remember when reading began');
select has_column('public'::name,'resources'::name,'rereading_since'::name,'and when a re-read began');

insert into auth.users(id,email) values
  ('1c000000-0000-4000-8000-000000000001','reading-a@paceon.example'),
  ('1c000000-0000-4000-8000-000000000002','reading-b@paceon.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-000000000001',true);
insert into learner_profiles(user_id,timezone) values(auth.uid(),'UTC');
create temporary table today as select (now() at time zone 'UTC')::date as d;
create function pg_temp.request(kind text, key text, version integer, end_page integer, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('kind',kind,'idempotencyKey',key,'expectedProgressVersion',version,
    'studyDate',(select d from today),'endPage',end_page,'durationMinutes',20,'memo','') || extra
$$;

-- 담기만 한 책은 읽기 전이다. 읽은 쪽을 적어 담은 책과 다 읽은 채로 담은 책은 시작한 책이다.
insert into resources(id,user_id,title,type,total_pages,initial_completed_workload,status) values
  ('2c000000-0000-4000-8000-000000000001',auth.uid(),'Wish list','BOOK',100,0,'ACTIVE'),
  ('2c000000-0000-4000-8000-000000000002',auth.uid(),'Half read','BOOK',100,40,'ACTIVE'),
  ('2c000000-0000-4000-8000-000000000003',auth.uid(),'Read long ago','BOOK',100,100,'COMPLETED');
select is((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000001'),null,'A book only added is not started');
select isnt((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000002'),null,'A book added with pages read is started');
select isnt((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000003'),null,'A book added as finished is started');

-- 서재의 독서 시작은 그 칸을 채우는 것이다.
update resources set reading_started_at=now() where id='2c000000-0000-4000-8000-000000000001';
select isnt((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000001'),null,'Starting from the library is a plain update');

-- 첫 기록도 시작이다.
insert into resources(id,user_id,title,type,total_pages,status) values
  ('2c000000-0000-4000-8000-000000000004',auth.uid(),'Recorded straight away','BOOK',50,'ACTIVE');
select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('LEARNING','3c000000-0000-4000-8000-000000000001',0,50),50,0,(select d from today));
select isnt((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000004'),null,'A first record starts the book');
select is((select status::text from resources where id='2c000000-0000-4000-8000-000000000004'),'COMPLETED','and here finishes it');

-- 다 읽기 전에는 재독할 수 없다. 챕터형 자료에는 읽기 상태가 없다.
select throws_ok($$update resources set rereading_since=now() where id='2c000000-0000-4000-8000-000000000002'$$,
  '23514',null,'An unfinished book cannot be re-read');
insert into resources(id,user_id,title,type,workload_unit,total_units,status) values
  ('2c000000-0000-4000-8000-000000000005',auth.uid(),'Course','COURSE','UNIT',3,'ACTIVE');
select throws_ok($$update resources set reading_started_at=now() where id='2c000000-0000-4000-8000-000000000005'$$,
  '23514',null,'A course has no reading state');

-- 재독 중이 아니면 다 읽은 책에 복습을 남기지 못한다.
select throws_ok($$select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('REVIEW','3c000000-0000-4000-8000-000000000002',1,10,'{"startPage":1}'),50,0,(select d from today))$$,
  '40001','Progress state changed','A finished book takes a review only while being re-read');

-- 재독 중에는 다시 읽은 범위가 복습으로 남는다. 진도와 완독은 그대로다.
update resources set rereading_since=now() where id='2c000000-0000-4000-8000-000000000004';
select is((submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('REVIEW','3c000000-0000-4000-8000-000000000003',1,20,'{"startPage":1}'),50,0,(select d from today)))->>'completedThroughPage',
  '50','A re-read review leaves progress where it was');
select is((select count(*) from progress_events where resource_id='2c000000-0000-4000-8000-000000000004' and event_type='REVIEW' and start_page=1 and end_page=20 and duration_minutes=20),
  1::bigint,'The re-read pages are a review record');
select is((select status::text from resources where id='2c000000-0000-4000-8000-000000000004'),'COMPLETED','The book stays finished');
select isnt((select rereading_since from resources where id='2c000000-0000-4000-8000-000000000004'),null,'and is still being re-read');
select throws_ok($$select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('REVIEW','3c000000-0000-4000-8000-000000000004',2,51,'{"startPage":21}'),50,0,(select d from today))$$,
  '23514','Invalid actual page range','A review stays inside the book');
select throws_ok($$select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('REVIEW','3c000000-0000-4000-8000-000000000005',2,20,'{"startPage":30}'),50,0,(select d from today))$$,
  '23514','Invalid actual page range','A review ends after it begins');
select throws_ok($$select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('LEARNING','3c000000-0000-4000-8000-000000000006',2,20,'{"startPage":1}'),50,0,(select d from today))$$,
  '23514','Invalid progress request','Only a review names where it began');

-- 마지막 쪽까지 다시 읽으면 재독이 끝난다.
select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('REVIEW','3c000000-0000-4000-8000-000000000007',2,50,'{"startPage":21}'),50,0,(select d from today));
select is((select rereading_since from resources where id='2c000000-0000-4000-8000-000000000004'),null,'Reaching the last page again ends the re-read');
select isnt((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000004'),null,'and the book stays started');

-- 재독 중에 마지막 기록을 고쳐 다 읽은 책이 아니게 되면 재독도 끝난다.
update resources set rereading_since=now() where id='2c000000-0000-4000-8000-000000000004';
select submit_unplanned_book_progress('2c000000-0000-4000-8000-000000000004',
  pg_temp.request('CORRECTION','3c000000-0000-4000-8000-000000000008',3,45,
    jsonb_build_object('eventId',(select id from progress_events where resource_id='2c000000-0000-4000-8000-000000000004' and event_type='LEARNING'))),
  50,0,(select d from today));
select is((select status::text from resources where id='2c000000-0000-4000-8000-000000000004'),'ACTIVE','A correction can take a book back from finished');
select is((select rereading_since from resources where id='2c000000-0000-4000-8000-000000000004'),null,'and that ends the re-read');

-- 계획을 세우면 시작한 책이다.
insert into resources(id,user_id,title,type,total_pages,status) values
  ('2c000000-0000-4000-8000-000000000006',auth.uid(),'Planned','BOOK',100,'ACTIVE');
insert into goals(id,user_id,resource_id,title,start_date,mode,preferred_daily_workload)
  values('4c000000-0000-4000-8000-000000000001',auth.uid(),'2c000000-0000-4000-8000-000000000006','Plan',(select d from today),'BALANCED',10);
insert into plans(user_id,resource_id,goal_id,mode,start_date,preferred_daily_workload)
  values(auth.uid(),'2c000000-0000-4000-8000-000000000006','4c000000-0000-4000-8000-000000000001','BALANCED',(select d from today),10);
select isnt((select reading_started_at from resources where id='2c000000-0000-4000-8000-000000000006'),null,'Making a plan starts the book');

-- 남의 책은 시작할 수 없다.
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-000000000002',true);
update resources set reading_started_at=now() where id='2c000000-0000-4000-8000-000000000001';
reset role;
select is((select count(*) from resources where id='2c000000-0000-4000-8000-000000000001' and user_id='1c000000-0000-4000-8000-000000000001'),1::bigint,'The book still belongs to its reader');

select * from finish();
rollback;
