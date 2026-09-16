begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_function('public','replace_availability_rules',array['jsonb'],'Availability replacement RPC exists');

insert into auth.users(id,email) values
 ('50000000-0000-4000-8000-000000000001','availability-owner@paceon.example'),
 ('50000000-0000-4000-8000-000000000002','availability-other@paceon.example');
insert into availability_rules(user_id,iso_weekday,available_minutes) values
 ('50000000-0000-4000-8000-000000000001',1,60),
 ('50000000-0000-4000-8000-000000000001',2,60),
 ('50000000-0000-4000-8000-000000000001',3,60),
 ('50000000-0000-4000-8000-000000000002',1,45);

set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-4000-8000-000000000001',true);

-- The whole week is replaced, not merged: days left out of the payload stop being study days.
select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":30},{"isoWeekday":5,"availableMinutes":120}]'::jsonb);
select is(
  (select jsonb_agg(jsonb_build_array(iso_weekday,available_minutes) order by iso_weekday)
     from availability_rules where user_id='50000000-0000-4000-8000-000000000001'),
  '[[1,30],[5,120]]'::jsonb,
  'Replacing the budget drops the weekdays the payload leaves out');
-- Every rejection must leave the saved budget untouched.
select throws_ok($$select replace_availability_rules('[]'::jsonb)$$,'23514',null,'An empty week is rejected');
select throws_ok($$select replace_availability_rules('{}'::jsonb)$$,'23514',null,'A non-array payload is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":0,"availableMinutes":30}]'::jsonb)$$,'23514',null,'Weekday 0 is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":8,"availableMinutes":30}]'::jsonb)$$,'23514',null,'Weekday 8 is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":0}]'::jsonb)$$,'23514',null,'Zero minutes is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":1441}]'::jsonb)$$,'23514',null,'More than a day of minutes is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":30.5}]'::jsonb)$$,'23514',null,'Fractional minutes are rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1.5,"availableMinutes":30}]'::jsonb)$$,'23514',null,'A fractional weekday is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":"1","availableMinutes":30}]'::jsonb)$$,'23514',null,'A weekday sent as text is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":30},{"isoWeekday":1,"availableMinutes":60}]'::jsonb)$$,'23514',null,'The same weekday twice is rejected');
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":10},{"isoWeekday":2,"availableMinutes":10},{"isoWeekday":3,"availableMinutes":10},{"isoWeekday":4,"availableMinutes":10},{"isoWeekday":5,"availableMinutes":10},{"isoWeekday":6,"availableMinutes":10},{"isoWeekday":7,"availableMinutes":10},{"isoWeekday":1,"availableMinutes":10}]'::jsonb)$$,'23514',null,'More than seven entries is rejected');
select is(
  (select jsonb_agg(jsonb_build_array(iso_weekday,available_minutes) order by iso_weekday)
     from availability_rules where user_id='50000000-0000-4000-8000-000000000001'),
  '[[1,30],[5,120]]'::jsonb,
  'A rejected payload leaves the saved budget exactly as it was');

-- A full week is allowed.
select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":10},{"isoWeekday":2,"availableMinutes":20},{"isoWeekday":3,"availableMinutes":30},{"isoWeekday":4,"availableMinutes":40},{"isoWeekday":5,"availableMinutes":50},{"isoWeekday":6,"availableMinutes":60},{"isoWeekday":7,"availableMinutes":70}]'::jsonb);
select is(
  (select count(*) from availability_rules where user_id='50000000-0000-4000-8000-000000000001'),
  7::bigint,
  'All seven weekdays can be saved at once');

reset role;
-- Checked without RLS in the way: the delete must never reach another learner's rows.
select is(
  (select count(*) from availability_rules where user_id='50000000-0000-4000-8000-000000000002'),
  1::bigint,
  'Another learner keeps their own budget');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select replace_availability_rules('[{"isoWeekday":1,"availableMinutes":30}]'::jsonb)$$,'42501',null,'A caller with no identity is refused');

select * from finish();
rollback;
