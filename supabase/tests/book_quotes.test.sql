begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

select has_table('public'::name,'book_quotes'::name,'The quotes table exists');
select ok(not has_table_privilege('anon','public.book_quotes','select'),'Anonymous cannot read quotes');

insert into auth.users(id,email) values
  ('1b000000-0000-4000-8000-000000000001','quotes-a@paceon.example'),
  ('1b000000-0000-4000-8000-000000000002','quotes-b@paceon.example');
set local role authenticated;
select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000001',true);
insert into resources(id,user_id,title,type,total_pages) values
  ('2b000000-0000-4000-8000-000000000001',auth.uid(),'Quoted book','BOOK',300);
insert into resources(id,user_id,title,type,workload_unit,total_units) values
  ('2b000000-0000-4000-8000-000000000002',auth.uid(),'A course','COURSE','UNIT',10);

-- A quote is kept with its page, with or without a note.
insert into book_quotes(user_id,resource_id,page,content,note) values
  (auth.uid(),'2b000000-0000-4000-8000-000000000001',121,'생각은 외주 줄 수 없다.','오늘 회의에 쓸 말'),
  (auth.uid(),'2b000000-0000-4000-8000-000000000001',300,'마지막 쪽의 문장.',null);
select is((select count(*) from book_quotes),2::bigint,'Quotes are saved, the last page included');

-- Quotes stay inside the book.
select throws_ok($$insert into book_quotes(user_id,resource_id,page,content) values(auth.uid(),'2b000000-0000-4000-8000-000000000001',301,'x')$$,
  '23514','Page is outside the book','A page past the end is refused');
select throws_ok($$insert into book_quotes(user_id,resource_id,page,content) values(auth.uid(),'2b000000-0000-4000-8000-000000000001',0,'x')$$,
  '23514',null,'Page zero is refused');
select throws_ok($$insert into book_quotes(user_id,resource_id,page,content) values(auth.uid(),'2b000000-0000-4000-8000-000000000001',5,'   ')$$,
  '23514',null,'A blank quote is refused');
select throws_ok($$insert into book_quotes(user_id,resource_id,page,content,note) values(auth.uid(),'2b000000-0000-4000-8000-000000000001',5,'x','  ')$$,
  '23514',null,'A blank note is stored as no note, never as spaces');
select throws_ok($$insert into book_quotes(user_id,resource_id,page,content) values(auth.uid(),'2b000000-0000-4000-8000-000000000002',1,'x')$$,
  '23514','Quotes belong to books read by page','A material without pages takes no quotes');
select throws_ok($$update book_quotes set page=400 where page=121$$,
  '23514','Page is outside the book','Moving a quote past the end is refused too');

update book_quotes set content='생각은 외주 줄 수 없다!', note=null where page=121;
select is((select content||'|'||coalesce(note,'-') from book_quotes where page=121),'생각은 외주 줄 수 없다!|-','A quote can be corrected and its note removed');
select ok((select updated_at >= created_at from book_quotes where page=121),'and the change is stamped');

-- Another reader neither sees nor reaches them.
select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000002',true);
select is((select count(*) from book_quotes),0::bigint,'Another reader sees no quotes');
select throws_ok($$insert into book_quotes(user_id,resource_id,page,content) values(auth.uid(),'2b000000-0000-4000-8000-000000000001',1,'x')$$,
  '23503',null,'Another reader cannot quote someone else''s book');
update book_quotes set content='taken' where page=121;
delete from book_quotes;

select set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-000000000001',true);
select is((select count(*) from book_quotes where content<>'taken'),2::bigint,'Their update and delete touched nothing');

-- Deleting the book takes its quotes with it.
delete from resources where id='2b000000-0000-4000-8000-000000000001';
select is((select count(*) from book_quotes),0::bigint,'Quotes go with their book');

select * from finish();
rollback;
