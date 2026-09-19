begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
  ('90000000-0000-4000-8000-000000000001','recall-a@paceon.example'),
  ('90000000-0000-4000-8000-000000000002','recall-b@paceon.example');
insert into public.resources(id,user_id,title,type,total_pages) values
  ('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','Deep Work','BOOK',300),
  ('91000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000002','Other reader''s book','BOOK',200);

set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000001',true);

-- What the reader recalled is the answer; nothing is left for a lookup to fill.
select lives_ok(
  $$insert into public.learning_expressions(id,user_id,kind,resource_id,start_page,end_page,phrase,meaning,due_on)
    values('92000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','RECALL',
           '91000000-0000-4000-8000-000000000001',41,60,'Deep Work · 41–60쪽','몰입은 훈련되는 능력이다','2026-09-20')$$,
  'A recall card is saved against the reader''s own book');

-- Reading the same pages again and recalling again is another retrieval, not a duplicate.
select lives_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,start_page,end_page,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001',41,60,
           'Deep Work · 41–60쪽','얕은 일은 쉽게 대체된다','2026-09-20')$$,
  'The same range may be recalled twice');

-- Expressions keep their once-only rule.
insert into public.learning_expressions(user_id,phrase,meaning,due_on)
  values('90000000-0000-4000-8000-000000000001','put off','미루다','2026-09-20');
select throws_ok(
  $$insert into public.learning_expressions(user_id,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','put off','연기하다','2026-09-20')$$,
  '23505', null, 'The same expression is still saved only once');

-- A recall card belongs to a book; an expression does not.
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','No book','떠올린 것','2026-09-20')$$,
  '23514', null, 'A recall card without a book is rejected');
select throws_ok(
  $$insert into public.learning_expressions(user_id,resource_id,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','tied','묶인','2026-09-20')$$,
  '23514', null, 'An expression cannot be tied to a book');

-- The owner rides along in the key, so another reader''s book cannot be pointed at.
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,start_page,end_page,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000002',1,10,
           'Not mine','남의 책','2026-09-20')$$,
  '23503', null, 'A recall card cannot reference a book the reader does not own');

-- Page ranges that cannot be true.
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,start_page,end_page,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001',60,41,'r','m','2026-09-20')$$,
  '23514', null, 'A range that ends before it starts is rejected');
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,start_page,end_page,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001',0,10,'r','m','2026-09-20')$$,
  '23514', null, 'Page zero is rejected');
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,start_page,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001',5,'r','m','2026-09-20')$$,
  '23514', null, 'Half a range is rejected');
select lives_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001','Deep Work','전체 소감','2026-09-20')$$,
  'A recall card may omit the range altogether');
select throws_ok(
  $$insert into public.learning_expressions(user_id,start_page,end_page,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001',1,2,'paged expression','m','2026-09-20')$$,
  '23514', null, 'An expression cannot carry a page range');

-- A recall card never waits on the AI, and needs its answer from the start.
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,phrase,due_on,lookup_status)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001','queued','2026-09-20','QUEUED')$$,
  '23514', null, 'A recall card cannot be queued for lookup');
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,resource_id,phrase,due_on)
    values('90000000-0000-4000-8000-000000000001','RECALL','91000000-0000-4000-8000-000000000001','empty','2026-09-20')$$,
  '23514', null, 'A recall card without what was recalled is rejected');
select throws_ok(
  $$insert into public.learning_expressions(user_id,kind,phrase,meaning,due_on)
    values('90000000-0000-4000-8000-000000000001','NOTE','x','y','2026-09-20')$$,
  '23514', null, 'An unknown kind is rejected');

-- The review function is shared: a recall card moves along the same intervals.
select is(
  (select review_step from public.record_expression_review(
    '92000000-0000-4000-8000-000000000001', 1::smallint, '2026-09-23', '2026-09-20')),
  1::smallint, 'A recall card is reviewed with the same function as an expression');

-- Another reader sees none of it.
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.learning_expressions), 0::bigint, 'Recall cards are private to their reader');

-- Removing the book takes its recall cards with it and leaves expressions alone.
reset role;
delete from public.resources where id='91000000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.learning_expressions where kind='RECALL'
     and user_id='90000000-0000-4000-8000-000000000001'),
  0::bigint, 'Deleting a book removes its recall cards');
select is(
  (select count(*) from public.learning_expressions where kind='EXPRESSION'
     and user_id='90000000-0000-4000-8000-000000000001'),
  1::bigint, 'Expressions survive the book being deleted');

select * from finish();
rollback;
