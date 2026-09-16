begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_table('public','learning_expressions','Expression table exists');
select has_function('public','record_expression_review',array['uuid','smallint','date','date'],'Review RPC exists');

insert into auth.users(id,email) values
 ('70000000-0000-4000-8000-000000000001','phrase-owner@paceon.example'),
 ('70000000-0000-4000-8000-000000000002','phrase-other@paceon.example');

set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);

insert into public.learning_expressions(id,user_id,phrase,meaning,due_on) values
 ('71000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','get around to','드디어 ~하다','2026-09-17');

-- The same learner cannot store one phrase twice; nothing is merged behind their back.
select throws_ok(
  $$insert into public.learning_expressions(user_id,phrase,meaning,due_on)
    values('70000000-0000-4000-8000-000000000001','get around to','다른 뜻','2026-09-18')$$,
  '23505', null, 'The same phrase is refused rather than duplicated or merged');

-- Blank text never becomes a card.
select throws_ok(
  $$insert into public.learning_expressions(user_id,phrase,meaning,due_on)
    values('70000000-0000-4000-8000-000000000001','   ','뜻','2026-09-18')$$,
  '23514', null, 'A blank phrase is rejected');
select throws_ok(
  $$insert into public.learning_expressions(user_id,phrase,meaning,due_on)
    values('70000000-0000-4000-8000-000000000001','pick up','  ','2026-09-18')$$,
  '23514', null, 'A blank meaning is rejected');
select throws_ok(
  $$insert into public.learning_expressions(user_id,phrase,meaning,due_on,review_step)
    values('70000000-0000-4000-8000-000000000001','pick up','줍다','2026-09-18',5)$$,
  '23514', null, 'A step outside the interval table is rejected');

-- Recording a review moves the card forward and counts the answer.
select record_expression_review('71000000-0000-4000-8000-000000000001', 2::smallint, date '2026-09-23', date '2026-09-16');
select is(
  (select array[review_step::text, due_on::text, last_reviewed_on::text, review_count::text]
     from public.learning_expressions where id='71000000-0000-4000-8000-000000000001'),
  array['2','2026-09-23','2026-09-16','1'],
  'A review stores the new interval, the next date and the day it was answered');

select record_expression_review('71000000-0000-4000-8000-000000000001', 0::smallint, date '2026-09-17', date '2026-09-16');
select is(
  (select review_count from public.learning_expressions where id='71000000-0000-4000-8000-000000000001'),
  2, 'Answering again counts again and the latest answer sets the date');

-- A next date must genuinely be in the future, so a card cannot be asked forever.
select throws_ok(
  $$select record_expression_review('71000000-0000-4000-8000-000000000001', 0::smallint, date '2026-09-16', date '2026-09-16')$$,
  '23514', null, 'A review cannot schedule itself for today');
select throws_ok(
  $$select record_expression_review('71000000-0000-4000-8000-000000000001', 0::smallint, date '2026-09-15', date '2026-09-16')$$,
  '23514', null, 'A review cannot schedule itself in the past');
select throws_ok(
  $$select record_expression_review('71000000-0000-4000-8000-000000000001', 0::smallint, date '2028-09-16', date '2026-09-16')$$,
  '23514', null, 'A review cannot be pushed years away');
select throws_ok(
  $$select record_expression_review('71000000-0000-4000-8000-000000000001', 9::smallint, date '2026-09-20', date '2026-09-16')$$,
  '23514', null, 'A step outside the table is refused by the RPC too');

-- Another learner can neither see nor move this card.
set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.learning_expressions), 0::bigint,
  'RLS hides another learner''s expressions');
select throws_ok(
  $$select record_expression_review('71000000-0000-4000-8000-000000000001', 0::smallint, date '2026-09-20', date '2026-09-16')$$,
  'P0002', null, 'Reviewing someone else''s card finds nothing to move');
-- The same phrase may be saved by a different learner.
select lives_ok(
  $$insert into public.learning_expressions(user_id,phrase,meaning,due_on)
    values('70000000-0000-4000-8000-000000000002','get around to','드디어 ~하다','2026-09-18')$$,
  'Two learners may each keep the same phrase');

reset role;
select * from finish();
rollback;
