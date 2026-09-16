begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_table('public','push_subscriptions','Push subscription table exists');
select has_function('public','claim_due_notifications',array['integer'],'Claim RPC exists');

-- The due window, on fixed clocks. Adding an interval to a bare time wraps past midnight
-- (22:59 + 2 hours = 00:59), which silently dropped every late-evening reminder.
select is(private.notification_due(timestamp '2026-09-16 23:30', time '22:59', null), true,
  'A late-evening reminder is still due half an hour later');
select is(private.notification_due(timestamp '2026-09-16 23:30', time '20:00', null), false,
  'More than two hours late is skipped for the day');
select is(private.notification_due(timestamp '2026-09-16 07:00', time '07:00', null), true,
  'The exact minute counts as due');
select is(private.notification_due(timestamp '2026-09-16 06:59', time '07:00', null), false,
  'A minute early is not due');
select is(private.notification_due(timestamp '2026-09-16 07:30', time '07:00', date '2026-09-16'), false,
  'A day already sent is not due again');
select is(private.notification_due(timestamp '2026-09-16 07:30', time '07:00', date '2026-09-15'), true,
  'Yesterday having been sent does not block today');
select is(private.notification_due(timestamp '2026-09-16 07:30', null, null), false,
  'No time set means no notification');
-- Just after midnight the previous evening's window has closed with the date.
select is(private.notification_due(timestamp '2026-09-17 00:30', time '22:59', null), false,
  'A window never leaks into the next day');
select has_function('public','finish_notification',array['uuid','boolean'],'Finish RPC exists');

insert into auth.users(id,email) values
 ('60000000-0000-4000-8000-000000000001','push-due@paceon.example'),
 ('60000000-0000-4000-8000-000000000002','push-early@paceon.example'),
 ('60000000-0000-4000-8000-000000000003','push-off@paceon.example'),
 ('60000000-0000-4000-8000-000000000004','push-nosub@paceon.example'),
 ('60000000-0000-4000-8000-000000000005','push-other@paceon.example');

-- Every profile is put one minute past its notify time in its own zone, so "due" is
-- decided by the rules under test rather than by when this suite happens to run.
insert into public.learner_profiles(user_id,timezone,notify_at,daily_learning_minutes) values
 ('60000000-0000-4000-8000-000000000001','Asia/Seoul',
   ((now() at time zone 'Asia/Seoul')::time - interval '1 minute')::time, 10),
 -- Two hours and a minute late: the window has closed, skip the day.
 ('60000000-0000-4000-8000-000000000002','Asia/Seoul',
   ((now() at time zone 'Asia/Seoul')::time - interval '2 hours 1 minute')::time, null),
 -- Notifications switched off.
 ('60000000-0000-4000-8000-000000000003','Asia/Seoul', null, null),
 -- Due, but no device is subscribed.
 ('60000000-0000-4000-8000-000000000004','Asia/Seoul',
   ((now() at time zone 'Asia/Seoul')::time - interval '1 minute')::time, null),
 ('60000000-0000-4000-8000-000000000005','Asia/Seoul',
   ((now() at time zone 'Asia/Seoul')::time - interval '1 minute')::time, null);

insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth) values
 ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','https://push.example/aaaaaaaaaaaaaaaaaaaa','key-aaaaaaaaaaaaaaaaaaaa','auth-aaaaaaaaaa'),
 -- A second device for the same learner: both must be told.
 ('61000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001','https://push.example/bbbbbbbbbbbbbbbbbbbb','key-bbbbbbbbbbbbbbbbbbbb','auth-bbbbbbbbbb'),
 ('61000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000002','https://push.example/cccccccccccccccccccc','key-cccccccccccccccccccc','auth-cccccccccc'),
 ('61000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000003','https://push.example/dddddddddddddddddddd','key-dddddddddddddddddddd','auth-dddddddddd'),
 ('61000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000005','https://push.example/eeeeeeeeeeeeeeeeeeee','key-eeeeeeeeeeeeeeeeeeee','auth-eeeeeeeeee');

set local role service_role;

-- Only the learner who is inside the window and owns a device is picked, once per device.
select is(
  (select array_agg(distinct user_id::text order by user_id::text) from claim_due_notifications(50)),
  array['60000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000005'],
  'Only learners inside the window with a device are claimed');
select is(
  (select count(*) from public.learner_profiles
    where user_id='60000000-0000-4000-8000-000000000001'
      and notify_last_sent_on=(now() at time zone 'Asia/Seoul')::date),
  1::bigint,
  'Claiming marks the day immediately');

-- The second pass returns nothing: a day is claimed once even if sending failed.
select is((select count(*) from claim_due_notifications(50)), 0::bigint,
  'A claimed day is never handed out twice');

-- Failure counting and expiry.
select finish_notification('61000000-0000-4000-8000-000000000001', false);
select is((select failure_count from public.push_subscriptions where id='61000000-0000-4000-8000-000000000001'),
  1::smallint, 'A failed send counts against the subscription');
select is((select count(*) from public.push_subscriptions where id='61000000-0000-4000-8000-000000000001'),
  1::bigint, 'One failure does not drop the subscription');
update public.push_subscriptions set failure_count=9 where id='61000000-0000-4000-8000-000000000001';
select finish_notification('61000000-0000-4000-8000-000000000001', false);
select is((select count(*) from public.push_subscriptions where id='61000000-0000-4000-8000-000000000001'),
  0::bigint, 'Ten failures drop the subscription');
select finish_notification('61000000-0000-4000-8000-000000000002', true);
select is((select count(*) from public.push_subscriptions where id='61000000-0000-4000-8000-000000000002'),
  0::bigint, 'A gone endpoint is removed at once');

reset role;

-- A learner may only ever see their own devices.
set local role authenticated;
select set_config('request.jwt.claim.sub','60000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.push_subscriptions), 1::bigint,
  'RLS limits a learner to their own subscriptions');
select throws_ok(
  $$insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
    values('60000000-0000-4000-8000-000000000001','https://push.example/ffffffffffffffffffff','key-ffffffffffffffffffff','auth-ffffffffff')$$,
  '42501', null, 'A learner cannot subscribe on behalf of someone else');
select throws_ok($$select * from claim_due_notifications(50)$$,
  '42501', null, 'A signed-in learner cannot claim notifications');
select throws_ok($$select finish_notification('61000000-0000-4000-8000-000000000003', true)$$,
  '42501', null, 'A signed-in learner cannot settle notifications');

-- Endpoint shape is enforced, so a non-HTTPS or empty target never reaches the sender.
select throws_ok(
  $$insert into public.push_subscriptions(user_id,endpoint,p256dh,auth)
    values('60000000-0000-4000-8000-000000000002','http://push.example/gggggggggggggggggggg','key-gggggggggggggggggggg','auth-gggggggggg')$$,
  '23514', null, 'A plain http endpoint is rejected');

reset role;
select * from finish();
rollback;
