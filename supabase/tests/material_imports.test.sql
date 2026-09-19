begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
  ('d7000000-0000-4000-8000-000000000001','import-a@paceon.example'),
  ('d7000000-0000-4000-8000-000000000002','import-b@paceon.example');

set local role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000001',true);

select lives_ok(
  $$insert into public.material_imports(user_id,source_url,page_title,input,context)
    values('d7000000-0000-4000-8000-000000000001','https://www.example-course.com/c/1','강의','커리큘럼
1. 소개 12:30','{"freeMinutes":60}'::jsonb)$$,
  'A reader can queue a page for outlining');
select is((select status from public.material_imports), 'QUEUED', 'It starts queued');

-- A reader may queue, but never decide the outcome.
select throws_ok(
  $$insert into public.material_imports(user_id,source_url,input,status,result)
    values('d7000000-0000-4000-8000-000000000001','https://x.example-course.com/','text','READY','{"units":[]}'::jsonb)$$,
  '42501', null, 'A reader cannot insert a finished result');
select throws_ok($$update public.material_imports set status='READY', result='{}'::jsonb$$, '42501', null, 'nor edit one afterwards');
select throws_ok(
  $$insert into public.material_imports(user_id,source_url,input)
    values('d7000000-0000-4000-8000-000000000002','https://x.example-course.com/','text')$$,
  '42501', null, 'nor queue on someone else''s behalf');
select throws_ok($$select public.claim_material_import()$$, '42501', null, 'nor claim work');
select throws_ok(
  $$select public.finish_material_import('d7000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001','{}'::jsonb,null)$$,
  '42501', null, 'nor settle it');

-- Size limits keep a hostile page from filling the table.
select throws_ok(
  $$insert into public.material_imports(user_id,source_url,input) values('d7000000-0000-4000-8000-000000000001','https://x.example-course.com/',repeat('가',60001))$$,
  '23514', null, 'Page text past the limit is refused');
select throws_ok(
  $$insert into public.material_imports(user_id,source_url,input) values('d7000000-0000-4000-8000-000000000001','https://x.example-course.com/','')$$,
  '23514', null, 'Empty page text is refused');

set local role service_role;
create temp table job as select public.claim_material_import() as j;
select is((select j->>'page_title' from job), '강의', 'The worker is handed the page title');
select ok((select j ? 'input' and j ? 'context' and j ? 'lease_token' from job), 'and the text, the numbers and a lease');
select ok((select not (j ? 'user_id') and not (j ? 'source_url') from job), 'but not who asked or for which address');
select is((select status from public.material_imports), 'RUNNING', 'The row is marked running');
select is(public.claim_material_import(), null, 'A leased row is not handed out twice');

select is(public.finish_material_import((select (j->>'id')::uuid from job), gen_random_uuid(), '{"found":true}'::jsonb, null), false, 'A stale lease cannot settle the row');
select is((select status from public.material_imports), 'RUNNING', 'and leaves it untouched');

select is(public.finish_material_import((select (j->>'id')::uuid from job), (select (j->>'lease_token')::uuid from job), null, 'PROVIDER_ERROR'), true, 'A failure is reported');
select is((select status from public.material_imports), 'QUEUED', 'and the row goes back in the queue');
select is((select error_code from public.material_imports), 'PROVIDER_ERROR', 'keeping a safe code, never provider text');

-- Second and third attempts fail too; the third settles it as failed.
select public.finish_material_import((j->>'id')::uuid, (j->>'lease_token')::uuid, null, 'PROVIDER_ERROR') from (select public.claim_material_import() j) a;
select public.finish_material_import((j->>'id')::uuid, (j->>'lease_token')::uuid, null, 'INVALID_OUTPUT') from (select public.claim_material_import() j) a;
select is((select status from public.material_imports), 'FAILED', 'Three failures and it stops being retried');
select is(public.claim_material_import(), null, 'A failed row is never claimed again');

-- A success keeps the proposal and drops the page text.
insert into public.material_imports(id,user_id,source_url,input) values ('d8000000-0000-4000-8000-000000000001','d7000000-0000-4000-8000-000000000001','https://www.example-course.com/c/2','긴 페이지 글');
select public.finish_material_import((j->>'id')::uuid, (j->>'lease_token')::uuid, '{"found":true,"units":[]}'::jsonb, null) from (select public.claim_material_import() j) a;
select is((select status from public.material_imports where id='d8000000-0000-4000-8000-000000000001'), 'READY', 'A result settles the row as ready');
select is((select input from public.material_imports where id='d8000000-0000-4000-8000-000000000001'), '-', 'and the page text is not kept');

-- An expired lease frees the row for another worker.
insert into public.material_imports(id,user_id,source_url,input) values ('d8000000-0000-4000-8000-000000000002','d7000000-0000-4000-8000-000000000001','https://www.example-course.com/c/3','text');
select public.claim_material_import();
update public.material_imports set lease_expires_at = now() - interval '1 minute' where id='d8000000-0000-4000-8000-000000000002';
select is((select public.claim_material_import()->>'id'), 'd8000000-0000-4000-8000-000000000002', 'A crashed worker does not strand the row');

-- Old rows are cleared as work is claimed.
insert into public.material_imports(id,user_id,source_url,input,status,created_at) values ('d8000000-0000-4000-8000-000000000003','d7000000-0000-4000-8000-000000000001','https://www.example-course.com/old','old','FAILED', now() - interval '8 days');
select public.claim_material_import();
select is((select count(*) from public.material_imports where id='d8000000-0000-4000-8000-000000000003'), 0::bigint, 'Rows older than a week are deleted');

-- The daily limit holds even when the web app is bypassed.
delete from public.material_imports;
insert into public.material_imports(user_id,source_url,input)
  select 'd7000000-0000-4000-8000-000000000001','https://www.example-course.com/n','text' from generate_series(1,20);
set local role authenticated;
select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000001',true);
select throws_ok(
  $$insert into public.material_imports(user_id,source_url,input) values('d7000000-0000-4000-8000-000000000001','https://www.example-course.com/21','text')$$,
  'P0001', 'IMPORT_LIMIT', 'The twenty-first request in a day is refused');

select set_config('request.jwt.claim.sub','d7000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.material_imports), 0::bigint, 'Another reader sees none of it');
select lives_ok(
  $$insert into public.material_imports(user_id,source_url,input) values('d7000000-0000-4000-8000-000000000002','https://www.example-course.com/b','text')$$,
  'and has a limit of their own');

select * from finish();
rollback;
