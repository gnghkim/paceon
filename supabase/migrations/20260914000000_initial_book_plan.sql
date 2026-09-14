-- Initial scheduling only. Progress recording / replacement remain a later RPC.
create or replace function public.create_initial_book_plan(
  p_resource_id uuid, p_expected_total integer, p_expected_completed numeric,
  p_options jsonb, p_sessions jsonb, p_forecast date
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  book public.resources;
  goal_id uuid;
  new_plan_id uuid;
  start_day date := (p_options->>'startDate')::date;
  target_day date := (p_options->>'targetDate')::date;
  plan_mode public.plan_mode := (p_options->>'mode')::public.plan_mode;
  zone text := p_options->>'timezone';
  speed numeric := (p_options->>'minutesPerPage')::numeric;
  pace numeric := (p_options->>'dailyPages')::numeric;
  incoming_rules jsonb;
  existing_rules jsonb;
  item jsonb;
  session_day date;
  previous_day date;
  next_page integer;
  last_page integer;
  duration integer;
  capacity integer;
  reserved numeric;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Serialize initial saves across ALL books belonging to this user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4));
  select * into book from public.resources where id=p_resource_id and user_id=owner_id for no key update;
  if not found then raise exception 'Book not found' using errcode='42501'; end if;
  if book.type <> 'BOOK' or book.status <> 'ACTIVE' or book.total_pages is distinct from p_expected_total
    or book.initial_completed_workload is distinct from p_expected_completed or p_expected_completed >= p_expected_total
    or exists(select 1 from public.plans where resource_id=book.id and status in ('ACTIVE','PAUSED'))
    or exists(select 1 from public.progress_events where resource_id=book.id) then
    raise exception 'Book state changed' using errcode='23514';
  end if;
  if zone is null or not private.valid_timezone(zone) or start_day is null or not isfinite(start_day)
    or start_day < (now() at time zone zone)::date or plan_mode is null
    or speed is null or speed < 0.1 or speed > 1440 or speed <> round(speed,3)
    or (plan_mode in ('PACE','BALANCED') and (pace is null or pace < 1 or pace <> trunc(pace)))
    or (plan_mode='DEADLINE' and target_day is null)
    or (target_day is not null and (not isfinite(target_day) or target_day < start_day)) then
    raise exception 'Invalid plan options' using errcode='23514';
  end if;
  if jsonb_typeof(p_options->'availability') is distinct from 'array' or jsonb_array_length(p_options->'availability') not between 1 and 7 then
    raise exception 'Invalid availability' using errcode='23514';
  end if;
  if exists(select 1 from jsonb_array_elements(p_options->'availability') a where
    (a->>'isoWeekday') is null or (a->>'availableMinutes') is null
    or (a->>'isoWeekday')::numeric not between 1 and 7 or (a->>'isoWeekday')::numeric <> trunc((a->>'isoWeekday')::numeric)
    or (a->>'availableMinutes')::numeric not between 1 and 1440 or (a->>'availableMinutes')::numeric <> trunc((a->>'availableMinutes')::numeric))
    or (select count(distinct a->>'isoWeekday') from jsonb_array_elements(p_options->'availability') a) <> jsonb_array_length(p_options->'availability') then
    raise exception 'Invalid availability' using errcode='23514';
  end if;
  select jsonb_agg(jsonb_build_object('day',(a->>'isoWeekday')::integer,'minutes',(a->>'availableMinutes')::integer) order by (a->>'isoWeekday')::integer)
    into incoming_rules from jsonb_array_elements(p_options->'availability') a;
  select jsonb_agg(jsonb_build_object('day',iso_weekday,'minutes',available_minutes) order by iso_weekday)
    into existing_rules from public.availability_rules where user_id=owner_id;
  if (existing_rules is not null and existing_rules <> incoming_rules)
    or (existing_rules is not null and exists(select 1 from public.learner_profiles where user_id=owner_id and timezone <> zone))
    or exists(select 1 from public.plans where user_id=owner_id and status in ('ACTIVE','PAUSED') and timezone <> zone) then
    raise exception 'Shared settings changed' using errcode='23514';
  end if;
  if jsonb_typeof(p_sessions) is distinct from 'array' or jsonb_array_length(p_sessions) not between 1 and 3660 then
    raise exception 'Invalid sessions' using errcode='23514';
  end if;
  next_page := book.initial_completed_workload::integer + 1;
  for item in select value from jsonb_array_elements(p_sessions) loop
    session_day := (item->>'studyDate')::date;
    last_page := (item->>'endPage')::integer;
    duration := ceil((last_page-next_page+1)*speed)::integer;
    if session_day is null or not isfinite(session_day) or session_day < start_day or session_day > start_day + 3659
      or (previous_day is not null and session_day <= previous_day)
      or (item->>'startPage')::integer is distinct from next_page or last_page is null or last_page < next_page or last_page > book.total_pages
      or duration is null or duration < 1
      or (plan_mode='DEADLINE' and session_day > target_day) then
      raise exception 'Invalid session range' using errcode='23514';
    end if;
    select (a->>'availableMinutes')::integer into capacity from jsonb_array_elements(p_options->'availability') a
      where (a->>'isoWeekday')::integer=extract(isodow from session_day)::integer;
    select coalesce(sum(coalesce(s.estimated_minutes,1440)),0) into reserved
      from public.schedule_sessions s join public.plans p on p.id=s.plan_id
      where s.user_id=owner_id and s.study_date=session_day and s.status <> 'SKIPPED' and p.status in ('ACTIVE','PAUSED');
    if capacity is null or reserved + duration > capacity then raise exception 'Daily capacity changed' using errcode='23514'; end if;
    previous_day := session_day;
    next_page := last_page + 1;
  end loop;
  if next_page <> book.total_pages + 1 or p_forecast is distinct from previous_day then raise exception 'Incomplete schedule' using errcode='23514'; end if;
  insert into public.learner_profiles(user_id,timezone) values(owner_id,zone)
    on conflict(user_id) do update set timezone=excluded.timezone;
  if existing_rules is null then
    insert into public.availability_rules(user_id,iso_weekday,available_minutes)
      select owner_id,(a->>'isoWeekday')::smallint,(a->>'availableMinutes')::integer from jsonb_array_elements(p_options->'availability') a;
  end if;
  insert into public.goals(user_id,resource_id,title,start_date,target_date,mode,preferred_daily_workload)
    values(owner_id,book.id,book.title,start_day,target_day,plan_mode,pace) returning id into goal_id;
  insert into public.plans(user_id,resource_id,goal_id,mode,start_date,target_date,forecast_date,timezone,preferred_daily_workload)
    values(owner_id,book.id,goal_id,plan_mode,start_day,target_day,p_forecast,zone,pace) returning id into new_plan_id;
  insert into public.schedule_sessions(user_id,resource_id,plan_id,study_date,planned_workload,start_page,end_page,estimated_minutes)
    select owner_id,book.id,new_plan_id,(s->>'studyDate')::date,(s->>'endPage')::integer-(s->>'startPage')::integer+1,
      (s->>'startPage')::integer,(s->>'endPage')::integer,ceil(((s->>'endPage')::integer-(s->>'startPage')::integer+1)*speed)::integer from jsonb_array_elements(p_sessions) s;
  return new_plan_id;
end;
$$;
revoke all on function public.create_initial_book_plan(uuid,integer,numeric,jsonb,jsonb,date) from public, anon;
grant execute on function public.create_initial_book_plan(uuid,integer,numeric,jsonb,jsonb,date) to authenticated;
