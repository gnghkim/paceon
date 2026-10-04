begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

-- Structure and who may call what.
select has_table('public','telegram_links','Links table exists');
select has_table('public','telegram_link_codes','Link code table exists');
select has_table('public','telegram_turns','Turn table exists');
select ok(has_function_privilege('authenticated','public.create_telegram_link_code()','execute'),'A reader can ask for a link code');
select ok(has_function_privilege('authenticated','public.unlink_telegram()','execute'),'and can unlink');
select ok(not has_function_privilege('anon','public.create_telegram_link_code()','execute'),'but a visitor cannot');
select ok(not has_function_privilege('anon','public.unlink_telegram()','execute'),'nor unlink');
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot run %s', r, f))
  from unnest(array['anon','authenticated']) r,
       unnest(array[
         'public.link_telegram(text,bigint,bigint)',
         'public.get_telegram_context(bigint)',
         'public.update_telegram_settings(uuid,jsonb)',
         'public.record_telegram_turn(uuid,jsonb)',
         'public.get_telegram_quiz_cards(uuid,integer)',
         'public.save_telegram_quiz_state(uuid,jsonb)',
         'public.record_correction_review(uuid,uuid,smallint,date,date)',
         'public.claim_due_telegram_reviews(integer)',
         'public.get_telegram_stats(uuid)']) f;
select ok(has_function_privilege('service_role', f, 'execute'), format('the worker can run %s', f))
  from unnest(array[
    'public.link_telegram(text,bigint,bigint)',
    'public.get_telegram_context(bigint)',
    'public.record_telegram_turn(uuid,jsonb)',
    'public.record_correction_review(uuid,uuid,smallint,date,date)',
    'public.claim_due_telegram_reviews(integer)']) f;

insert into auth.users(id,email) values
  ('1c000000-0000-4000-8000-00000000000a','telegram-a@paceon.example'),
  ('1c000000-0000-4000-8000-00000000000b','telegram-b@paceon.example');
insert into learner_profiles(user_id,timezone) values
  ('1c000000-0000-4000-8000-00000000000a','UTC'),
  ('1c000000-0000-4000-8000-00000000000b','UTC');
create temporary table today as select (now() at time zone 'UTC')::date as d;
grant select on today to authenticated, service_role;
create temporary table codes(owner text, code text, n serial);
grant all on codes to authenticated, service_role;
grant usage on sequence codes_n_seq to authenticated, service_role;

-- Link codes: shown once, kept only as a hash, ten minutes, one use, a few an hour.
set local role authenticated;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-00000000000a',true);
insert into codes(owner, code) select 'a', create_telegram_link_code()->>'code';
select matches((select code from codes order by n desc limit 1), '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$', 'The code is eight unambiguous characters');
-- BETWEEN evaluates its left side twice, so the code is made once and kept.
insert into codes(owner, code) select 'expiry', create_telegram_link_code()->>'expiresAt';
select ok((select code::timestamptz between now() + interval '9 minutes' and now() + interval '11 minutes' from codes where owner = 'expiry'),
  'and lasts ten minutes');
select throws_ok($$select * from telegram_link_codes$$,'42501',null,'A reader cannot read code hashes');
insert into codes(owner, code) select 'a', create_telegram_link_code()->>'code' from generate_series(1,3);
select throws_ok($$select create_telegram_link_code()$$,'P0001','LINK_CODE_LIMIT','A sixth code within the hour is refused');

set local role service_role;
select is(link_telegram((select code from codes where owner='a' order by n limit 1),1001,1001),'INVALID_CODE','A replaced code no longer links');
select is(link_telegram(lower((select code from codes where owner='a' order by n desc limit 1)),1001,1001),'LINKED','The latest code links, typed in any case');
select is(link_telegram((select code from codes where owner='a' order by n desc limit 1),1001,1001),'INVALID_CODE','and cannot be used twice');
select is((select telegram_user_id from telegram_links where user_id='1c000000-0000-4000-8000-00000000000a'),1001::bigint,'The link is stored');
select is((select count(*) from telegram_link_codes where code_hash = (select code from codes limit 1)),0::bigint,'No code is stored in plain text');

set local role authenticated;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-00000000000b',true);
insert into codes(owner, code) select 'b', create_telegram_link_code()->>'code';
set local role service_role;
update telegram_link_codes set expires_at = now() - interval '1 second' where user_id='1c000000-0000-4000-8000-00000000000b';
select is(link_telegram((select code from codes where owner='b' order by n desc limit 1),2002,2002),'INVALID_CODE','An expired code does not link');
set local role authenticated;
insert into codes(owner, code) select 'b', create_telegram_link_code()->>'code';
set local role service_role;
select is(link_telegram((select code from codes where owner='b' order by n desc limit 1),1001,1001),'TELEGRAM_IN_USE','A Telegram account already linked elsewhere is refused');
select is((select used_at from telegram_link_codes where user_id='1c000000-0000-4000-8000-00000000000b' and used_at is not null), null, 'and the refused code is not spent');
select is(link_telegram((select code from codes where owner='b' order by n desc limit 1),2002,2002),'LINKED','Another Telegram account links');

-- What the worker learns about a sender.
select is(get_telegram_context(9999), null, 'An unknown sender has no context');
select is((get_telegram_context(1001)->>'userId'),'1c000000-0000-4000-8000-00000000000a','A linked sender maps to the reader');
select is((get_telegram_context(1001)->>'level'),'INTERMEDIATE','with the default level');
select is((get_telegram_context(1001)->>'timezone'),'UTC','in the reader''s time zone');
select is((get_telegram_context(1001)->>'today'),(select d::text from today),'with today''s local date');
select is((get_telegram_context(1001)->>'turnsToday')::integer,0,'and no turns yet');

select is((update_telegram_settings('1c000000-0000-4000-8000-00000000000a','{"level":"ADVANCED","scenario":"AIRPORT","voiceReplies":true,"reviewAt":"08:30"}')->>'level'),'ADVANCED','Settings change from bot commands');
select is((select (scenario, voice_replies, review_at)::text from telegram_links where user_id='1c000000-0000-4000-8000-00000000000a'),'(AIRPORT,t,08:30:00)','all of them');
select throws_ok($$select update_telegram_settings('1c000000-0000-4000-8000-00000000000a','{"level":"EXPERT"}')$$,'23514',null,'An unknown level is refused');
select throws_ok($$select update_telegram_settings('1c000000-0000-4000-8000-00000000000a','{"location":"Seoul"}')$$,'23514',null,'An unknown setting is refused');
select lives_ok($$select update_telegram_settings('1c000000-0000-4000-8000-00000000000a','{"scenario":null}')$$,'A scenario can be turned off');

-- A turn is stored once, and explained mistakes become correction cards.
create function pg_temp.turn(message bigint, cards jsonb, extra jsonb default '{}') returns jsonb language sql as $$
  select record_telegram_turn('1c000000-0000-4000-8000-00000000000a', jsonb_build_object(
    'chatId',1001,'messageId',message,'inputKind','TEXT',
    'learnerText','Yesterday I go to the park and buyed a apple.',
    'tutorTurn',jsonb_build_object('reply','Nice!'),'replyText','Nice! [Feedback]',
    'mistakeCount',3,'rewriteAttempt',false,'rewriteCorrect',null,
    'cards',cards,
    'pendingRewrite',jsonb_build_object('original','Yesterday I go','target','Yesterday I went','fixes',jsonb_build_array('go → went'))) || extra)
$$;
grant execute on function pg_temp.turn(bigint,jsonb,jsonb) to service_role;
create temporary table first_turn as select pg_temp.turn(1, '[
  {"wrong":"go","correct":"went","rule":"어제 일은 과거형으로 써요.","category":"GRAMMAR","sourceSentence":"Yesterday I go to the park and buyed a apple."},
  {"wrong":"buyed","correct":"bought","rule":"buy의 과거형은 bought예요.","category":"GRAMMAR","sourceSentence":"Yesterday I go to the park and buyed a apple."}]') r;
grant select on first_turn to authenticated;
select is((select r->>'duplicate' from first_turn),'false','A new message is recorded');
select is((select count(*) from telegram_turns where user_id='1c000000-0000-4000-8000-00000000000a'),1::bigint,'as one turn');
select is((select count(*) from learning_expressions where user_id='1c000000-0000-4000-8000-00000000000a' and kind='CORRECTION'),2::bigint,'with a card for each explained mistake');
select is((select (phrase, meaning, review_step, due_on, lookup_status, occurrences)::text from learning_expressions where wrong_text='go'),
  format('(go,went,0,%s,NONE,1)', (select d+1 from today)),'Each card starts tomorrow at the first interval, with nothing to look up');
select is((select source_turn_id from learning_expressions where wrong_text='go'),(select (r->>'turnId')::uuid from first_turn),'and remembers the turn it came from');
select is((select pending_rewrite->>'target' from telegram_links where user_id='1c000000-0000-4000-8000-00000000000a'),'Yesterday I went','The rewrite to ask for is kept');

select is((pg_temp.turn(1, '[]'))->>'duplicate','true','The same message again is recognised');
select is((select count(*) from telegram_turns where user_id='1c000000-0000-4000-8000-00000000000a'),1::bigint,'and stores nothing');

update learning_expressions set review_step = 3, due_on = (select d+14 from today) where wrong_text='go';
select lives_ok($$select pg_temp.turn(2, '[{"wrong":"Go","correct":"Went","rule":"과거형이에요.","category":"GRAMMAR","sourceSentence":"Last week I go to school."},
  {"wrong":"Its","correct":"its","rule":"x","category":"SPELLING","sourceSentence":"Its fine."}]', '{"pendingRewrite":null}')$$,
  'A repeated mistake is recorded');
select is((select (occurrences, review_step, due_on, source_sentence)::text from learning_expressions where kind='CORRECTION' and lower(wrong_text)='go'),
  format('(2,0,%s,"Last week I go to school.")', (select d+1 from today)),'It counts again, starts over tomorrow and shows the latest sentence');
select is((select count(*) from learning_expressions where kind='CORRECTION' and lower(wrong_text)='its'),0::bigint,'A change of case alone is not a mistake to keep');
select is((select pending_rewrite from telegram_links where user_id='1c000000-0000-4000-8000-00000000000a'),null,'A turn without a rewrite clears the old one');
select is((get_telegram_context(1001)->>'turnsToday')::integer,2,'Turns today are counted for the daily limit');

select throws_ok($$select pg_temp.turn(3, '[]', '{"chatId":2002}')$$,'42501',null,'A turn from another chat is refused');
select throws_ok($$select record_telegram_turn('1c000000-0000-4000-8000-00000000000c','{}')$$,'P0002',null,'A reader without a link cannot record');
select throws_ok($$select pg_temp.turn(4, '[{"wrong":"a","correct":"b","rule":"r","category":"GRAMMAR","sourceSentence":"s"},{"wrong":"c","correct":"d","rule":"r","category":"GRAMMAR","sourceSentence":"s"},{"wrong":"e","correct":"f","rule":"r","category":"GRAMMAR","sourceSentence":"s"}]')$$,
  '23514',null,'No more than two mistakes are explained, so no more than two cards per turn');
select throws_ok($$select pg_temp.turn(5, '[{"wrong":"a","correct":"b","rule":"r","category":"STYLE","sourceSentence":"s"}]')$$,'23514',null,'An unknown category is refused');

-- What the reader sees in the browser.
set local role authenticated;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-00000000000a',true);
select is((select count(*) from telegram_turns),2::bigint,'A reader sees their own turns');
select is((select count(*) from telegram_links),1::bigint,'and their own link');
select throws_ok($$insert into learning_expressions(user_id,kind,phrase,meaning,wrong_text,correct_text,rule_text,mistake_category,source_sentence,due_on)
  values(auth.uid(),'CORRECTION','x','y','x','y','r','GRAMMAR','s',current_date+1)$$,'42501',null,'A correction card cannot be made in the browser');
select throws_ok($$update learning_expressions set kind='EXPRESSION' where wrong_text='buyed'$$,'23514',null,'A card cannot change its kind');
select throws_ok($$update telegram_links set level='BEGINNER'$$,'42501',null,'Settings are not written directly');
select lives_ok($$select record_expression_review((select id from learning_expressions where wrong_text='buyed'),1::smallint,(select d+3 from today),(select d from today))$$,
  'The web review grades a correction card like any other');
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-00000000000b',true);
select is((select count(*) from telegram_turns),0::bigint,'Another reader sees none of the turns');
select is((select count(*) from learning_expressions where kind='CORRECTION'),0::bigint,'nor the cards');

-- Quiz and quiz results, recorded by the worker for the owner only.
set local role service_role;
select is(jsonb_array_length(get_telegram_quiz_cards('1c000000-0000-4000-8000-00000000000a',3)),0,'Nothing is due on the day it was saved');
update learning_expressions set due_on = (select d from today) where kind='CORRECTION';
insert into learning_expressions(user_id,phrase,meaning,due_on) values('1c000000-0000-4000-8000-00000000000a','take off','이륙하다',(select d from today));
select is((select jsonb_agg(c->>'wrongText' order by c->>'wrongText') from jsonb_array_elements(get_telegram_quiz_cards('1c000000-0000-4000-8000-00000000000a',3)) c),'["buyed", "go"]'::jsonb,
  'The quiz asks due correction cards only');
select is((record_correction_review('1c000000-0000-4000-8000-00000000000a',(select id from learning_expressions where wrong_text='buyed'),2::smallint,(select d+7 from today),(select d from today)))->>'reviewStep','2',
  'A quiz answer moves the card');
select is((select (review_step, due_on, review_count)::text from learning_expressions where wrong_text='buyed'),format('(2,%s,2)', (select d+7 from today)),'on the same row the web review uses');
select throws_ok($$select record_correction_review('1c000000-0000-4000-8000-00000000000b',(select id from learning_expressions where wrong_text='buyed'),1::smallint,(select d+3 from today),(select d from today))$$,
  'P0002',null,'Another reader''s card cannot be graded');
select throws_ok($$select record_correction_review('1c000000-0000-4000-8000-00000000000a',(select id from learning_expressions where phrase='take off'),1::smallint,(select d+3 from today),(select d from today))$$,
  'P0002',null,'Only correction cards are graded from Telegram');
select throws_ok($$select record_correction_review('1c000000-0000-4000-8000-00000000000a',(select id from learning_expressions where wrong_text='buyed'),5::smallint,(select d+3 from today),(select d from today))$$,
  '23514',null,'The interval stays within the five steps');
select throws_ok($$select record_correction_review('1c000000-0000-4000-8000-00000000000a',(select id from learning_expressions where wrong_text='buyed'),1::smallint,(select d from today),(select d from today))$$,
  '23514',null,'The next review is after today');
select is(save_telegram_quiz_state('1c000000-0000-4000-8000-00000000000a','{"cardIds":[],"index":0}'),true,'Quiz progress is kept');
select throws_ok($$select save_telegram_quiz_state('1c000000-0000-4000-8000-00000000000a','[]')$$,'23514',null,'and must be an object');

-- Morning review: once a day after the chosen time, with yesterday's talk.
insert into telegram_turns(id,user_id,chat_id,message_id,input_kind,learner_text,tutor_turn,reply_text,created_at)
  values('1d000000-0000-4000-8000-000000000001','1c000000-0000-4000-8000-00000000000a',1001,100,'TEXT','I goed home yesterday.','{}','ok',now() - interval '1 day');
update learning_expressions set source_turn_id='1d000000-0000-4000-8000-000000000001' where wrong_text='buyed';
insert into telegram_turns(id,user_id,chat_id,message_id,input_kind,learner_text,tutor_turn,reply_text,created_at)
  values('1d000000-0000-4000-8000-000000000002','1c000000-0000-4000-8000-00000000000a',1001,101,'TEXT','Very old.','{}','ok',now() - interval '181 days');
update telegram_links set review_at = date_trunc('second', (now() at time zone 'UTC'))::time where user_id='1c000000-0000-4000-8000-00000000000a';
update telegram_links set review_at = (date_trunc('second', (now() at time zone 'UTC')) + interval '3 hours')::time where user_id='1c000000-0000-4000-8000-00000000000b';
create temporary table claimed as select claim_due_telegram_reviews(20) r;
select is((select jsonb_array_length(r) from claimed),1,'Only the reader whose time has come is picked');
select is((select r->0->>'chatId' from claimed),'1001','with the chat to write to');
select is((select r->0->'yesterdayTurns' from claimed),'["I goed home yesterday."]'::jsonb,'yesterday''s sentences');
select is((select r->0->'yesterdayCorrections'->0->>'correctText' from claimed),'bought','and yesterday''s corrections');
select is(jsonb_array_length(claim_due_telegram_reviews(20)),0,'A second claim the same day picks no one');
select is((select count(*) from telegram_turns where id='1d000000-0000-4000-8000-000000000002'),0::bigint,'Turns older than 180 days are deleted');
select is((select count(*) from telegram_turns where id='1d000000-0000-4000-8000-000000000001'),1::bigint,'newer ones stay');

-- /stats.
select is((get_telegram_stats('1c000000-0000-4000-8000-00000000000a')->>'turns')::integer,3,'Stats count this week''s turns');
select is((get_telegram_stats('1c000000-0000-4000-8000-00000000000a')->>'streak')::integer,2,'the streak of days');
select is((get_telegram_stats('1c000000-0000-4000-8000-00000000000a')->'recurring'->0->>'wrongText'),'go','and mistakes made more than once');

-- Unlinking, and account deletion.
set local role authenticated;
select set_config('request.jwt.claim.sub','1c000000-0000-4000-8000-00000000000a',true);
select is(unlink_telegram(),true,'A reader can unlink');
set local role service_role;
select is(get_telegram_context(1001),null,'and the bot no longer knows them');
select is((select count(*) from telegram_turns where user_id='1c000000-0000-4000-8000-00000000000a'),3::bigint,'while the turns stay in PaceOn');
select is((select count(*) from learning_expressions where user_id='1c000000-0000-4000-8000-00000000000a' and kind='CORRECTION'),2::bigint,'and so do the cards');
delete from telegram_turns where user_id='1c000000-0000-4000-8000-00000000000a' and message_id=2;
select is((select source_turn_id from learning_expressions where wrong_text='go'),null,'Deleting a turn keeps its cards and forgets where they came from');
reset role;
delete from auth.users where id in ('1c000000-0000-4000-8000-00000000000a','1c000000-0000-4000-8000-00000000000b');
select is((select count(*) from telegram_links) + (select count(*) from telegram_link_codes) + (select count(*) from telegram_turns)
  + (select count(*) from learning_expressions where kind='CORRECTION'),0::bigint,'Deleting the accounts removes links, codes, turns and cards');

select * from finish();
rollback;
