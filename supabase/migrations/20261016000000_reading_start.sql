-- 독서 시작과 재독.
--
-- 서재에 담기만 한 책과 다 읽은 책이 독서 기록 창의 목록을 채워, 지금 읽는 책을
-- 찾기 어려웠다. 이제 책에 "읽기 시작했다"와 "다시 읽는 중이다"를 둔다.
--
--   reading_started_at  비어 있으면 읽기 전이다. 서재의 독서 시작, 계획 만들기, 첫 기록,
--                       등록할 때 읽은 쪽이 있으면 채워진다.
--   rereading_since     완독한 책을 다시 읽는 중이면 그 시작 시각이다. 재독은 복습 기록으로
--                       남고, 마지막 쪽까지 다시 읽으면 저절로 비워진다.
--
-- 쪽으로 읽는 책에만 쓴다. 챕터형 자료(교재, 강의)는 독서 기록 창과 상관없다.

alter table public.resources
  add column reading_started_at timestamptz check (isfinite(reading_started_at)),
  add column rereading_since timestamptz check (isfinite(rereading_since));

-- 이미 시작한 책: 계획이 있었거나, 기록이 있거나, 등록할 때 읽은 쪽이 있거나, 다 읽은 책.
-- 시작 시각은 첫 기록, 첫 계획, 등록 시각 중 먼저 있는 것이다.
update public.resources r set reading_started_at = coalesce(
    (select min(e.created_at) from public.progress_events e where e.resource_id = r.id and e.user_id = r.user_id),
    (select min(p.created_at) from public.plans p where p.resource_id = r.id and p.user_id = r.user_id),
    r.created_at)
  where r.workload_unit = 'PAGE' and (
    r.status = 'COMPLETED' or r.initial_completed_workload > 0
    or exists(select 1 from public.plans p where p.resource_id = r.id and p.user_id = r.user_id)
    or exists(select 1 from public.progress_events e where e.resource_id = r.id and e.user_id = r.user_id));

alter table public.resources
  add constraint resources_reading_state check (
    (workload_unit = 'PAGE' or (reading_started_at is null and rereading_since is null))
    and (rereading_since is null or (status = 'COMPLETED' and reading_started_at is not null)));

-- 등록할 때 이미 읽은 쪽이 있거나 다 읽은 책은 시작한 책이다. 다 읽은 책이 아니게 되면
-- (마지막 기록 정정, 보관) 재독도 끝난다.
create function private.keep_reading_state() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workload_unit <> 'PAGE' then return new; end if;
  if new.reading_started_at is null and (new.initial_completed_workload > 0 or new.status = 'COMPLETED') then
    new.reading_started_at := now();
  end if;
  -- 다 읽은 책에서 벗어날 때만 비운다. 다 읽지 않은 책을 재독하려는 것은 검사가 거절한다.
  if tg_op = 'UPDATE' and old.status = 'COMPLETED' and new.status <> 'COMPLETED' then
    new.rereading_since := null;
  end if;
  return new;
end;
$$;
create trigger resources_reading_state before insert or update on public.resources
for each row execute function private.keep_reading_state();

-- 계획을 세우면 읽기 시작한 것이다.
create function private.start_reading_on_plan() returns trigger
language plpgsql set search_path = '' as $$
begin
  update public.resources set reading_started_at = now()
    where id = new.resource_id and user_id = new.user_id and workload_unit = 'PAGE' and reading_started_at is null;
  return null;
end;
$$;
create trigger plans_start_reading after insert on public.plans
for each row execute function private.start_reading_on_plan();

-- 기록이 생기면 읽기 시작한 것이다. 재독 중에 마지막 쪽까지 다시 읽으면 재독이 끝난다.
create function private.follow_reading_record() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.event_type = 'VOID' then return null; end if;
  update public.resources set reading_started_at = coalesce(reading_started_at, now()),
      rereading_since = case
        when new.event_type = 'REVIEW' and new.end_page is not null and new.end_page >= total_pages then null
        else rereading_since end
    where id = new.resource_id and user_id = new.user_id and workload_unit = 'PAGE'
      and (reading_started_at is null
        or (rereading_since is not null and new.event_type = 'REVIEW' and new.end_page >= total_pages));
  return null;
end;
$$;
create trigger progress_events_reading_state after insert on public.progress_events
for each row execute function private.follow_reading_record();

-- 계획 없이 다 읽은 책도 재독하는 동안에는 복습을 받는다. 그 밖에는 전과 같다.
create or replace function public.submit_unplanned_book_progress(
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
  -- Reading, the correction of the latest reading, and a review while re-reading a
  -- finished book. Only a review names where it began.
  if jsonb_typeof(p_request) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_request) k
      where k not in ('kind','idempotencyKey','expectedProgressVersion','studyDate','startPage','endPage','durationMinutes','memo','eventId'))
    or kind is null or kind not in ('LEARNING','CORRECTION','REVIEW')
    or (kind <> 'CORRECTION' and p_request ? 'eventId')
    or (kind = 'CORRECTION' and jsonb_typeof(p_request->'eventId') is distinct from 'string')
    or (kind = 'REVIEW' and jsonb_typeof(p_request->'startPage') is distinct from 'number')
    or (kind <> 'REVIEW' and p_request ? 'startPage')
    or jsonb_typeof(p_request->'idempotencyKey') is distinct from 'string'
    or jsonb_typeof(p_request->'studyDate') is distinct from 'string'
    or jsonb_typeof(p_request->'endPage') is distinct from 'number'
    or jsonb_typeof(p_request->'expectedProgressVersion') is distinct from 'number'
    or coalesce(jsonb_typeof(p_request->'durationMinutes'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_request->'memo'), 'string') <> 'string'
    or exists(select 1 from jsonb_each(p_request) f where f.key in ('startPage','endPage','durationMinutes','expectedProgressVersion')
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
  -- leave a book finished for good. It takes a review only while it is being re-read.
  if book.type <> 'BOOK' or book.status not in ('ACTIVE','COMPLETED')
    or (book.status = 'ACTIVE' and kind = 'REVIEW')
    or (book.status = 'COMPLETED' and kind = 'LEARNING')
    or (kind = 'REVIEW' and book.rereading_since is null)
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
  if kind = 'REVIEW' then
    -- 다시 읽은 범위. 진도는 늘지 않는다.
    actual_start := (p_request->>'startPage')::integer;
    if actual_start < 1 or actual_end < actual_start or actual_end > book.total_pages then
      raise exception 'Invalid actual page range' using errcode='23514';
    end if;
    insert into public.progress_events(user_id,resource_id,event_type,study_date,timezone,start_page,end_page,completed_workload,duration_minutes,memo,idempotency_key)
      values(owner_id,book.id,'REVIEW',study_day,zone,actual_start,actual_end,actual_end-actual_start+1,duration,p_request->>'memo',key_id)
      returning id into event_id;
  else
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
