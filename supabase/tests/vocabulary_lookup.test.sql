begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_function('public','claim_expression_lookup',array[]::text[],'Lookup claim RPC exists');
select has_function('public','finish_expression_lookup',array['uuid','uuid','text','text[]','boolean'],'Lookup finish RPC exists');

insert into auth.users(id,email) values ('80000000-0000-4000-8000-000000000001','vocab@paceon.example');

-- A word typed by the learner arrives with no meaning yet.
insert into public.learning_expressions(id,user_id,phrase,due_on,lookup_status)
  values ('81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','serendipity','2026-09-18','QUEUED');
-- One the learner wrote out themselves is settled from the start.
insert into public.learning_expressions(id,user_id,phrase,meaning,due_on)
  values ('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000001','put off','미루다','2026-09-18');

-- A settled card must carry a meaning; a waiting one need not.
select throws_ok(
  $$insert into public.learning_expressions(user_id,phrase,due_on)
    values('80000000-0000-4000-8000-000000000001','no meaning','2026-09-18')$$,
  '23514', null, 'A card with nothing pending must have a meaning');
select lives_ok(
  $$insert into public.learning_expressions(user_id,phrase,due_on,lookup_status)
    values('80000000-0000-4000-8000-000000000001','waiting','2026-09-18','QUEUED')$$,
  'A word waiting on the lookup may have no meaning yet');

-- Example bounds are enforced by the array check.
select throws_ok(
  $$update public.learning_expressions set examples=array['a','b','c','d','e','f']
    where id='81000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'More than five examples is rejected');
select throws_ok(
  $$update public.learning_expressions set examples=array['  ']
    where id='81000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'A blank example is rejected');
select throws_ok(
  $$update public.learning_expressions set examples=array[repeat('x',501)]
    where id='81000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'An overlong example is rejected');
select lives_ok(
  $$update public.learning_expressions set examples=array['I put it off again.','Do not put off today.']
    where id='81000000-0000-4000-8000-000000000002'$$,
  'Two ordinary examples are accepted');

set local role service_role;

-- Claiming hands out the word and leases it, so a second worker gets the other one.
select is((select claim_expression_lookup()->>'phrase'), 'serendipity',
  'The oldest waiting word is claimed first');
select is((select claim_expression_lookup()->>'phrase'), 'waiting',
  'A second claim takes the next word, not the leased one');
select is((select claim_expression_lookup()), null,
  'With nothing left to claim the RPC returns nothing');
select is(
  (select lookup_status from public.learning_expressions where id='81000000-0000-4000-8000-000000000001'),
  'RUNNING', 'A claimed word is marked as running');

-- Finishing stores the meaning and examples and settles the card.
select is(
  finish_expression_lookup('81000000-0000-4000-8000-000000000001',
    (select lease_token from public.learning_expressions where id='81000000-0000-4000-8000-000000000001'),
    '뜻밖의 발견', array['It was pure serendipity.','Serendipity brought us here.'], false),
  true, 'A finished lookup is accepted');
select is(
  (select array[meaning, lookup_status, array_length(examples,1)::text, lease_token::text]
     from public.learning_expressions where id='81000000-0000-4000-8000-000000000001'),
  array['뜻밖의 발견','READY','2',null],
  'The meaning and examples land and the lease is released');

-- A result arriving after the lease moved on is discarded.
select is(
  finish_expression_lookup('81000000-0000-4000-8000-000000000001', gen_random_uuid(), '다른 뜻', array['x'], false),
  false, 'A stale lease cannot overwrite a settled card');
select is(
  (select meaning from public.learning_expressions where id='81000000-0000-4000-8000-000000000001'),
  '뜻밖의 발견', 'The settled meaning is untouched by the late result');

-- A failure goes back into the queue so the next pass can retry.
select is(
  finish_expression_lookup('81000000-0000-4000-8000-000000000003',
    (select lease_token from public.learning_expressions where phrase='waiting'), null, null, true),
  false, 'An unknown id settles nothing');
select is(
  finish_expression_lookup((select id from public.learning_expressions where phrase='waiting'),
    (select lease_token from public.learning_expressions where phrase='waiting'), null, null, true),
  true, 'A failed lookup is accepted');
select is(
  (select lookup_status from public.learning_expressions where phrase='waiting'),
  'QUEUED', 'A failed lookup waits to be tried again');

-- After enough tries the word is left alone rather than retried forever.
update public.learning_expressions set lookup_attempts=5 where phrase='waiting';
select is(
  finish_expression_lookup((select id from public.learning_expressions where phrase='waiting'),
    (select lease_token from public.learning_expressions where phrase='waiting'), null, null, true),
  false, 'A released lease cannot be settled twice');
select claim_expression_lookup();
select is(
  (select lookup_status from public.learning_expressions where phrase='waiting'),
  'FAILED', 'A word that keeps failing stops being claimed');

reset role;

-- A signed-in learner can neither claim nor settle lookups.
set local role authenticated;
select set_config('request.jwt.claim.sub','80000000-0000-4000-8000-000000000001',true);
select throws_ok($$select claim_expression_lookup()$$, '42501', null,
  'A learner cannot claim lookups');
select throws_ok(
  $$select finish_expression_lookup('81000000-0000-4000-8000-000000000001', gen_random_uuid(), 'x', array['y'], false)$$,
  '42501', null, 'A learner cannot settle lookups');

reset role;
select * from finish();
rollback;
