-- 계획 없이 읽은 것도 기록한다.
--
-- 책을 서재에 넣고 바로 읽기 시작하는 사람이 있다. 지금까지는 진도 기록이 계획에 묶여
-- 있어서, 계획을 세우기 전에는 읽은 쪽수도 타이머로 잰 시간도 남길 곳이 없었다.
-- 도서 화면은 계획이 없어도 읽기 타이머를 켜 주는데, 끄고 나면 기록할 책 목록에 그
-- 책이 없어 잰 시간이 사라졌다.
--
-- 이제 계획이 없는 책에도 읽은 진도와 시간을 쌓는다. 일정이 없으니 다시 짤 일정도
-- 없다. 그래서 계획 있는 기록과 달리 후보 일정을 받지 않는다. 계획이 있는 책(진행,
-- 일시정지, 완료)은 이 길로 들어올 수 없다. 들어오면 그 책의 일정이 진도를 모르게 된다.
--
-- 나중에 계획을 세우면 이미 읽은 쪽 다음부터 일정을 잡는다. 전에는 기록이 하나라도
-- 있는 책에는 계획을 만들지 못하게 막아 두었는데, 이제 그 기록을 일정의 시작점으로 삼는다.

create function public.submit_unplanned_book_progress(
  p_resource_id uuid, p_request jsonb, p_expected_total integer, p_expected_initial numeric, p_as_of_date date
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  book public.resources;
  prior public.progress_submissions;
  kind text;
  key_id uuid;
  study_day date;
  actual_start integer;
  actual_end integer;
  duration integer;
  zone text;
  completed integer;
  latest public.progress_events;
  ev public.progress_events;
  event_id uuid;
  submission_id uuid := gen_random_uuid();
  answer jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  kind := p_request->>'kind';
  -- Only reading and the correction of the latest reading. A review needs a finished
  -- book, and a finished book reaches review through its plan.
  if jsonb_typeof(p_request) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_request) k
      where k not in ('kind','idempotencyKey','expectedProgressVersion','studyDate','endPage','durationMinutes','memo','eventId'))
    or kind is null or kind not in ('LEARNING','CORRECTION')
    or (kind = 'LEARNING' and p_request ? 'eventId')
    or (kind = 'CORRECTION' and jsonb_typeof(p_request->'eventId') is distinct from 'string')
    or jsonb_typeof(p_request->'idempotencyKey') is distinct from 'string'
    or jsonb_typeof(p_request->'studyDate') is distinct from 'string'
    or jsonb_typeof(p_request->'endPage') is distinct from 'number'
    or jsonb_typeof(p_request->'expectedProgressVersion') is distinct from 'number'
    or coalesce(jsonb_typeof(p_request->'durationMinutes'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_request->'memo'), 'string') <> 'string'
    or exists(select 1 from jsonb_each(p_request) f where f.key in ('endPage','durationMinutes','expectedProgressVersion')
      and jsonb_typeof(f.value) = 'number' and (f.value::text)::numeric <> trunc((f.value::text)::numeric)) then
    raise exception 'Invalid progress request' using errcode='23514';
  end if;
  key_id := (p_request->>'idempotencyKey')::uuid;
  study_day := (p_request->>'studyDate')::date;
  actual_end := (p_request->>'endPage')::integer;
  duration := (p_request->>'durationMinutes')::integer;
  -- The same lock as planned records and plan creation: one writer per reader at a time.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4));
  select * into prior from public.progress_submissions where user_id=owner_id and idempotency_key=key_id;
  if found then
    if prior.resource_id <> p_resource_id or prior.request is distinct from p_request then
      raise exception 'Idempotency key reused' using errcode='40001'; end if;
    return prior.result;
  end if;
  select * into book from public.resources where id=p_resource_id and user_id=owner_id for no key update;
  if not found then raise exception 'Book not found' using errcode='42501'; end if;
  -- A finished book may still take a correction: a mistyped last page should not
  -- leave a book finished for good.
  if book.type <> 'BOOK' or book.status not in ('ACTIVE','COMPLETED')
    or (book.status = 'COMPLETED' and kind <> 'CORRECTION')
    or exists(select 1 from public.plans where resource_id=book.id and status in ('ACTIVE','PAUSED','COMPLETED'))
    or book.total_pages is distinct from p_expected_total or book.initial_completed_workload is distinct from p_expected_initial
    or book.progress_version is distinct from (p_request->>'expectedProgressVersion')::bigint then
    raise exception 'Progress state changed' using errcode='40001';
  end if;
  select timezone into zone from public.learner_profiles where user_id=owner_id;
  zone := coalesce(zone, 'Asia/Seoul');
  if p_as_of_date is distinct from (now() at time zone zone)::date
    or study_day is null or not isfinite(study_day) or study_day > p_as_of_date
    or (duration is not null and (duration < 0 or duration > 1440))
    or length(coalesce(p_request->>'memo', '')) > 10000 then
    raise exception 'Invalid progress request' using errcode='23514';
  end if;
  completed := book.initial_completed_workload::integer;
  for ev in select e.* from public.progress_events e where e.resource_id=book.id and e.event_type='LEARNING'
    and not exists(select 1 from public.progress_events v where v.voids_event_id=e.id) order by e.start_page,e.created_at,e.id loop
    if ev.start_page is distinct from completed+1 or ev.end_page is null or ev.end_page<ev.start_page or ev.end_page>book.total_pages then
      raise exception 'Non-contiguous progress history' using errcode='23514'; end if;
    completed := ev.end_page; latest := ev;
  end loop;
  if kind = 'LEARNING' then
    actual_start := completed + 1;
  else
    if latest.id is null or latest.id is distinct from (p_request->>'eventId')::uuid then
      raise exception 'Only latest learning can be corrected' using errcode='23514'; end if;
    actual_start := latest.start_page;
  end if;
  -- A correction down to the page before it began withdraws that reading entirely.
  if actual_end > book.total_pages or actual_end < actual_start - (case when kind = 'CORRECTION' then 1 else 0 end) then
    raise exception 'Invalid actual page range' using errcode='23514';
  end if;
  completed := actual_end;
  if kind = 'CORRECTION' then
    insert into public.progress_events(user_id,resource_id,event_type,study_date,timezone,completed_workload,idempotency_key,voids_event_id,memo)
      values(owner_id,book.id,'VOID',study_day,zone,0,gen_random_uuid(),latest.id,p_request->>'memo') returning id into event_id;
  end if;
  if actual_end >= actual_start then
    insert into public.progress_events(user_id,resource_id,event_type,study_date,timezone,start_page,end_page,completed_workload,duration_minutes,memo,idempotency_key)
      values(owner_id,book.id,'LEARNING',study_day,zone,actual_start,actual_end,actual_end-actual_start+1,duration,p_request->>'memo',key_id)
      returning id into event_id;
  end if;
  update public.resources set progress_version=progress_version+1,
    status=case when completed=book.total_pages then 'COMPLETED'::public.resource_status else 'ACTIVE'::public.resource_status end
    where id=book.id;
  answer := jsonb_build_object('submissionId',submission_id,'eventId',event_id,'completedThroughPage',completed,
    'progressVersion',book.progress_version+1,'planVersion',null,'replanStatus','applied',
    'forecastBefore',null,'forecastAfter',null,'conflicts','[]'::jsonb,'unplanned',true);
  insert into public.progress_submissions(id,user_id,idempotency_key,resource_id,request,result)
    values(submission_id,owner_id,key_id,book.id,p_request,answer);
  return answer;
end;
$$;
revoke all on function public.submit_unplanned_book_progress(uuid,jsonb,integer,numeric,date) from public, anon;
grant execute on function public.submit_unplanned_book_progress(uuid,jsonb,integer,numeric,date) to authenticated;

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
  completed integer;
  ev public.progress_events;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Serialize initial saves across ALL books belonging to this user.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4));
  select * into book from public.resources where id=p_resource_id and user_id=owner_id for no key update;
  if not found then raise exception 'Book not found' using errcode='42501'; end if;
  -- Pages read before there was a plan count. The schedule starts after them.
  completed := book.initial_completed_workload::integer;
  for ev in select e.* from public.progress_events e where e.resource_id=book.id and e.event_type='LEARNING'
    and not exists(select 1 from public.progress_events v where v.voids_event_id=e.id) order by e.start_page,e.created_at,e.id loop
    if ev.start_page is distinct from completed+1 or ev.end_page is null or ev.end_page<ev.start_page or ev.end_page>book.total_pages then
      raise exception 'Non-contiguous progress history' using errcode='23514'; end if;
    completed := ev.end_page;
  end loop;
  if book.type <> 'BOOK' or book.status <> 'ACTIVE' or book.total_pages is distinct from p_expected_total
    or completed::numeric is distinct from p_expected_completed or p_expected_completed >= p_expected_total
    or exists(select 1 from public.plans where resource_id=book.id and status in ('ACTIVE','PAUSED')) then
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
  next_page := completed + 1;
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
  insert into public.plans(user_id,resource_id,goal_id,mode,start_date,target_date,forecast_date,timezone,preferred_daily_workload,minutes_per_page)
    values(owner_id,book.id,goal_id,plan_mode,start_day,target_day,p_forecast,zone,pace,speed) returning id into new_plan_id;
  insert into public.schedule_sessions(user_id,resource_id,plan_id,study_date,planned_workload,start_page,end_page,estimated_minutes)
    select owner_id,book.id,new_plan_id,(s->>'studyDate')::date,(s->>'endPage')::integer-(s->>'startPage')::integer+1,
      (s->>'startPage')::integer,(s->>'endPage')::integer,ceil(((s->>'endPage')::integer-(s->>'startPage')::integer+1)*speed)::integer from jsonb_array_elements(p_sessions) s;
  return new_plan_id;
end;
$$;

revoke all on function public.create_initial_book_plan(uuid,integer,numeric,jsonb,jsonb,date) from public, anon;
grant execute on function public.create_initial_book_plan(uuid,integer,numeric,jsonb,jsonb,date) to authenticated;
