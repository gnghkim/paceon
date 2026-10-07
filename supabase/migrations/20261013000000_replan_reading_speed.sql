-- 계획을 다시 나눌 때 읽는 속도도 고친다.
--
-- 계획은 만들 때 고른 쪽당 시간(예: 천천히 2분)으로 일정을 나눈다. 실제 속도는 기록이
-- 세 개 쌓여야 반영되는데, 그 전에는 고칠 길이 없었다. 쪽당 2분으로 만든 계획에서
-- 실제로는 0.4분에 읽는 사람이 목표 날짜를 앞당기면, 하루에 들어가는 쪽수가 실제의
-- 다섯 분의 일로 계산되어 목표 날짜를 맞출 수 없다고 나왔다. 균형 조정 방식은 그 경우
-- 조용히 더 늦은 날짜로 일정을 잡아, 바꾼 것이 반영되지 않은 것처럼 보였다.
--
-- 다시 나누기 요청에 minutesPerPage를 받는다. 기록이 부족할 때 쓰는 기본 속도를 바꾸는
-- 것이고, 시간 기록이 세 개 이상이면 지금처럼 실제 속도가 우선한다. 일정을 배치하지
-- 못한 요청은 아무것도 바꾸지 않으므로 속도도 그대로 둔다.

create or replace function public.submit_book_progress(p_resource_id uuid,p_request jsonb,p_candidate jsonb,p_expected_sessions jsonb,p_expected_total integer,p_expected_initial numeric,p_as_of_date date)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 owner_id uuid:=auth.uid(); book public.resources; active_plan public.plans; prior public.progress_submissions;
 kind text:=p_request->>'kind'; key_id uuid:=(p_request->>'idempotencyKey')::uuid;
 study_day date:=(p_request->>'studyDate')::date; actual_end integer:=(p_request->>'endPage')::integer; actual_start integer;
 duration integer:=(p_request->>'durationMinutes')::integer;
 completed integer; old_completed integer; latest public.progress_events; ev public.progress_events;
 event_id uuid; run_id uuid:=gen_random_uuid(); submission_id uuid:=gen_random_uuid(); answer jsonb;
 snapshot jsonb; eligible uuid[]; supplied uuid[]; sched jsonb:=p_candidate->'schedule'; item jsonb; row_item record;
 speed numeric:=(p_candidate->>'minutesPerPage')::numeric;
 mode_value public.plan_mode; pace numeric; target_day date; forecast date; previous_day date; start_day date;
 next_page integer; capacity integer;
 success boolean; version_after bigint; expected_speed numeric; expected_source text;
 new_speed numeric;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,4));
 select * into prior from public.progress_submissions where user_id=owner_id and idempotency_key=key_id;
 if found then
  if prior.resource_id<>p_resource_id or prior.request is distinct from p_request then raise exception 'Idempotency key reused' using errcode='40001'; end if;
  return prior.result;
 end if;
 select * into book from public.resources where id=p_resource_id and user_id=owner_id for no key update;
 if not found then raise exception 'Book not found' using errcode='42501'; end if;
 select * into active_plan from public.plans where id=(p_request->>'planId')::uuid and resource_id=book.id and user_id=owner_id for no key update;
 if not found then raise exception 'Plan not found' using errcode='42501'; end if;
 if book.type<>'BOOK' or book.status='ARCHIVED' or active_plan.status not in('ACTIVE','COMPLETED')
  or book.total_pages is distinct from p_expected_total or book.initial_completed_workload is distinct from p_expected_initial
  or active_plan.version is distinct from (p_request->>'expectedPlanVersion')::bigint or book.progress_version is distinct from (p_request->>'expectedProgressVersion')::bigint then
  raise exception 'Progress state changed' using errcode='40001'; end if;
 if exists(select 1 from jsonb_each(p_request) f where f.key in('startPage','endPage','durationMinutes','expectedPlanVersion','expectedProgressVersion','dailyPages') and f.value<>'null'::jsonb and (jsonb_typeof(f.value)<>'number' or (f.value::text)::numeric<>trunc((f.value::text)::numeric))) then raise exception 'Integer request values required' using errcode='23514'; end if;
 if key_id is null or kind is null or kind not in('LEARNING','REVIEW','CORRECTION','REPLAN') or p_as_of_date is distinct from (now() at time zone active_plan.timezone)::date
  or (kind<>'REPLAN' and study_day is null) or (study_day is not null and (not isfinite(study_day) or study_day>p_as_of_date))
  or (duration is not null and duration<0) or length(p_request->>'memo')>10000 then raise exception 'Invalid progress request' using errcode='23514'; end if;
 if (kind<>'REPLAN' and p_request ?| array['mode','dailyPages','targetDate','minutesPerPage'])
  or (kind='REPLAN' and p_request ?| array['endPage','startPage','durationMinutes','memo','eventId'])
  or (kind<>'CORRECTION' and p_request ? 'eventId') then raise exception 'Invalid request fields' using errcode='23514'; end if;
 -- A replan may correct the reading speed the plan was made with, within the bounds
 -- a new plan accepts. It only counts until there are enough timed records.
 if p_request ? 'minutesPerPage' then
  if jsonb_typeof(p_request->'minutesPerPage') is distinct from 'number' then raise exception 'Invalid reading speed' using errcode='23514'; end if;
  new_speed:=(p_request->>'minutesPerPage')::numeric;
  if new_speed<0.1 or new_speed>1440 or new_speed<>round(new_speed,3) then raise exception 'Invalid reading speed' using errcode='23514'; end if;
 end if;
 perform 1 from public.schedule_sessions where plan_id=active_plan.id for update;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'study_date',s.study_date,'start_page',s.start_page,'end_page',s.end_page,'estimated_minutes',s.estimated_minutes,'status',s.status,'is_locked',s.is_locked,'plan_version',s.plan_version) order by s.id),'[]'::jsonb) into snapshot from public.schedule_sessions s where s.plan_id=active_plan.id;
 if snapshot is distinct from p_expected_sessions then raise exception 'Session state changed' using errcode='40001'; end if;
 completed:=book.initial_completed_workload::integer;
 for ev in select e.* from public.progress_events e where e.resource_id=book.id and e.event_type='LEARNING' and not exists(select 1 from public.progress_events v where v.voids_event_id=e.id) order by e.start_page,e.created_at,e.id loop
  if ev.start_page is distinct from completed+1 or ev.end_page is null or ev.end_page<ev.start_page or ev.end_page>book.total_pages then raise exception 'Non-contiguous progress history' using errcode='23514'; end if;
  completed:=ev.end_page; latest:=ev;
 end loop;
 old_completed:=completed;
 if kind='LEARNING' then actual_start:=completed+1;
 elsif kind='REVIEW' then actual_start:=(p_request->>'startPage')::integer;
 elsif kind='CORRECTION' then
  if latest.id is null or latest.id is distinct from (p_request->>'eventId')::uuid then raise exception 'Only latest learning can be corrected' using errcode='23514'; end if;
  actual_start:=latest.start_page; completed:=actual_start-1;
 end if;
 if kind<>'REPLAN' then
  if actual_start is null or actual_start<1 or actual_end is null or actual_end>book.total_pages or actual_end<actual_start-(case when kind='CORRECTION' then 1 else 0 end)
    or (kind<>'REVIEW' and p_request ? 'startPage' and (p_request->>'startPage')::integer is distinct from actual_start) then raise exception 'Invalid actual page range' using errcode='23514'; end if;
  if kind<>'REVIEW' then completed:=actual_end; end if;
 end if;
 if (p_candidate->>'completedThroughPage')::numeric is distinct from completed::numeric or speed is null or speed<=0 or (p_candidate->>'speedSource' is null or p_candidate->>'speedSource' not in('observed','fallback')) then raise exception 'Invalid progress candidate' using errcode='23514'; end if;
 select case when count(*)>=3 then sum(sample.duration)::numeric/sum(sample.pages) else coalesce(new_speed,active_plan.minutes_per_page) end,
  case when count(*)>=3 then 'observed' else 'fallback' end
 into expected_speed, expected_source
 from (
  select e.duration_minutes duration,e.end_page-e.start_page+1 pages from public.progress_events e
  where e.resource_id=book.id and e.event_type='LEARNING' and e.duration_minutes>0 and e.study_date<=p_as_of_date and e.study_date>p_as_of_date-30
   and not exists(select 1 from public.progress_events v where v.voids_event_id=e.id)
   and not(kind='CORRECTION' and e.id=latest.id)
  union all select duration,actual_end-actual_start+1 where kind in('LEARNING','CORRECTION') and actual_end>=actual_start and duration>0 and study_day>p_as_of_date-30
 ) sample;
 if abs(speed-expected_speed)>0.000000001 or p_candidate->>'speedSource' is distinct from expected_source then raise exception 'Reading speed changed' using errcode='23514'; end if;
 mode_value:=case when kind='REPLAN' and p_request ? 'mode' then (p_request->>'mode')::public.plan_mode else active_plan.mode end;
 pace:=case when kind='REPLAN' and p_request ? 'dailyPages' then (p_request->>'dailyPages')::numeric else active_plan.preferred_daily_workload end;
 target_day:=case when kind='REPLAN' and p_request ? 'targetDate' then (p_request->>'targetDate')::date else active_plan.target_date end;
 if mode_value is null or (mode_value in('PACE','BALANCED') and (pace is null or pace<1 or pace<>trunc(pace))) or (mode_value='DEADLINE' and target_day is null)
  or (target_day is not null and (not isfinite(target_day) or target_day<active_plan.start_date))
  or (p_candidate->>'mode') is distinct from mode_value::text or (p_candidate->>'dailyPages')::numeric is distinct from pace or (p_candidate->>'targetDate')::date is distinct from target_day then raise exception 'Invalid candidate options' using errcode='23514'; end if;
 if sched->>'status' is null or sched->>'status' not in('ok','completed','conflict') then raise exception 'Invalid schedule status' using errcode='23514'; end if;
 success:=sched->>'status'<>'conflict';
 select coalesce(array_agg(s.id order by s.id),'{}'::uuid[]) into eligible from public.schedule_sessions s where s.plan_id=active_plan.id and s.study_date>p_as_of_date and s.status in('PLANNED','SKIPPED') and not s.is_locked and not exists(select 1 from public.progress_events e where e.session_id=s.id);
 start_day:=greatest(active_plan.start_date,p_as_of_date+1);
 if success then
  if jsonb_typeof(sched->'sessions') is distinct from 'array' or jsonb_array_length(sched->'sessions')>3660 or jsonb_typeof(sched->'replacedSessionIds') is distinct from 'array' or jsonb_typeof(sched->'preservedSessions') is distinct from 'array' or jsonb_typeof(sched->'reasons') is distinct from 'array' then raise exception 'Invalid schedule shape' using errcode='23514'; end if;
  select coalesce(array_agg(value::uuid order by value::uuid),'{}'::uuid[]) into supplied from jsonb_array_elements_text(sched->'replacedSessionIds');
  if supplied is distinct from eligible then raise exception 'Invalid replacement set' using errcode='23514'; end if;
  select coalesce(array_agg((value->>'id')::uuid order by (value->>'id')::uuid),'{}'::uuid[]) into supplied from jsonb_array_elements(sched->'preservedSessions');
  if supplied is distinct from (select coalesce(array_agg(id order by id),'{}'::uuid[]) from public.schedule_sessions where plan_id=active_plan.id and not(id=any(eligible))) then raise exception 'Invalid preservation set' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(sched->'sessions') x where exists(select 1 from jsonb_each(x) f where f.key in('startPage','endPage','pages','estimatedMinutes') and (jsonb_typeof(f.value)<>'number' or (f.value::text)::numeric<>trunc((f.value::text)::numeric)))) then raise exception 'Integer session values required' using errcode='23514'; end if;
  for item in select value from jsonb_array_elements(sched->'preservedSessions') loop
   if not exists(select 1 from public.schedule_sessions s where s.id=(item->>'id')::uuid and s.plan_id=active_plan.id and s.study_date=(item->>'studyDate')::date and s.start_page=(item->>'startPage')::integer and s.end_page=(item->>'endPage')::integer and s.estimated_minutes=(item->>'estimatedMinutes')::numeric and s.status::text=item->>'status' and (s.is_locked or exists(select 1 from public.progress_events e where e.session_id=s.id))=(item->>'isLocked')::boolean) then raise exception 'Preserved session changed' using errcode='23514'; end if;
  end loop;
  if exists(select 1 from public.schedule_sessions where plan_id=active_plan.id and study_date>p_as_of_date and status='COMPLETED' and end_page>completed) then raise exception 'Completed future range exceeds progress' using errcode='23514'; end if;
  -- Validate the combined new and fixed future ranges, in page order.
  next_page:=completed+1;
  for row_item in
   select (x->>'studyDate')::date as scheduled_day,(x->>'startPage')::integer first_page,(x->>'endPage')::integer last_page,ceil(((x->>'endPage')::integer-(x->>'startPage')::integer+1)*speed-0.000000001)::integer duration,true fresh,x
   from jsonb_array_elements(sched->'sessions') x
   union all select study_date,start_page,end_page,estimated_minutes,false,null::jsonb from public.schedule_sessions where plan_id=active_plan.id and study_date>p_as_of_date and not(id=any(eligible)) and status<>'COMPLETED'
   order by first_page,scheduled_day
  loop
   if row_item.scheduled_day is null or not isfinite(row_item.scheduled_day) or row_item.scheduled_day<start_day or row_item.scheduled_day>start_day+3659 or (previous_day is not null and row_item.scheduled_day<previous_day)
    or row_item.first_page is distinct from next_page or row_item.last_page is null or row_item.last_page<next_page or row_item.last_page>book.total_pages or row_item.duration is null or row_item.duration<1
    or (mode_value='DEADLINE' and row_item.scheduled_day>target_day)
    or (row_item.fresh and ((row_item.x->>'pages')::integer is distinct from row_item.last_page-row_item.first_page+1 or (row_item.x->>'estimatedMinutes')::numeric is distinct from row_item.duration::numeric)) then raise exception 'Invalid remaining schedule coverage' using errcode='23514'; end if;
   next_page:=row_item.last_page+1; previous_day:=row_item.scheduled_day;
  end loop;
  forecast:=case when completed=book.total_pages then p_as_of_date else previous_day end;
  if next_page<>book.total_pages+1 or (sched->>'forecastDate')::date is distinct from forecast or (sched->>'status'='completed') is distinct from (completed=book.total_pages) then raise exception 'Invalid completion forecast' using errcode='23514'; end if;
  -- Completed submissions create no future allocation and need no capacity check.
  if completed<book.total_pages then
  -- Recheck every future occupied date, including fixed sessions and other books.
  for row_item in
   select scheduled_day,sum(amount) amount from (
    select (x->>'studyDate')::date as scheduled_day,(x->>'estimatedMinutes')::numeric amount from jsonb_array_elements(sched->'sessions') x
    union all select s.study_date,coalesce(s.estimated_minutes,1440) from public.schedule_sessions s join public.plans p on p.id=s.plan_id where s.user_id=owner_id and s.study_date between start_day and start_day+3659 and ((s.plan_id=active_plan.id and s.status<>'COMPLETED' and not(s.id=any(eligible))) or (s.plan_id<>active_plan.id and p.status in('ACTIVE','PAUSED') and s.status<>'SKIPPED'))
   ) occupied group by scheduled_day
  loop
   select available_minutes into capacity from public.availability_rules where user_id=owner_id and iso_weekday=extract(isodow from row_item.scheduled_day)::integer;
   if capacity is null or row_item.amount>capacity then raise exception 'Daily capacity changed' using errcode='40001'; end if;
  end loop;
  end if;
 else
  if jsonb_typeof(sched->'conflicts') is distinct from 'array' or jsonb_array_length(sched->'conflicts')=0 or sched ? 'sessions' then raise exception 'Invalid conflict candidate' using errcode='23514'; end if;
 end if;
 -- All candidate validation precedes writes. Any later exception rolls back this transaction.
 if kind='CORRECTION' then
  insert into public.progress_events(user_id,resource_id,event_type,study_date,timezone,completed_workload,idempotency_key,voids_event_id,memo)
   values(owner_id,book.id,'VOID',study_day,active_plan.timezone,0,gen_random_uuid(),latest.id,p_request->>'memo') returning id into event_id;
 end if;
 if kind in('LEARNING','REVIEW') or (kind='CORRECTION' and actual_end>=actual_start) then
  insert into public.progress_events(user_id,resource_id,event_type,study_date,timezone,start_page,end_page,completed_workload,duration_minutes,memo,idempotency_key)
   values(owner_id,book.id,case when kind='REVIEW' then 'REVIEW'::public.progress_event_type else 'LEARNING'::public.progress_event_type end,study_day,active_plan.timezone,actual_start,actual_end,actual_end-actual_start+1,duration,p_request->>'memo',key_id) returning id into event_id;
 end if;
 update public.schedule_sessions set status=case when end_page<=completed then 'COMPLETED'::public.session_status when start_page<=completed then 'IN_PROGRESS'::public.session_status when study_date<p_as_of_date then 'SKIPPED'::public.session_status else 'PLANNED'::public.session_status end
  where plan_id=active_plan.id and study_date<=p_as_of_date and start_page is not null;
 forecast:=case when success then forecast when completed<book.total_pages and active_plan.forecast_date<active_plan.start_date then null else active_plan.forecast_date end;
 version_after:=active_plan.version+case when success or (active_plan.status='COMPLETED') is distinct from (completed=book.total_pages) then 1 else 0 end;
 if success then
  update public.plans set minutes_per_page=coalesce(new_speed,minutes_per_page),mode=mode_value,preferred_daily_workload=pace,target_date=target_day,forecast_date=forecast,status=case when completed=book.total_pages then 'COMPLETED'::public.plan_status else 'ACTIVE'::public.plan_status end where id=active_plan.id;
 elsif version_after<>active_plan.version then
  update public.plans set forecast_date=forecast,status=case when completed=book.total_pages then 'COMPLETED'::public.plan_status else 'ACTIVE'::public.plan_status end where id=active_plan.id;
 end if;
 insert into public.replan_runs(id,user_id,resource_id,plan_id,idempotency_key,status,from_version,to_version,policy_version,reason,before_snapshot,after_snapshot)
 values(run_id,owner_id,book.id,active_plan.id,key_id,case when success then 'APPLIED'::public.replan_status else 'SKIPPED'::public.replan_status end,active_plan.version,version_after,'progress-v1',jsonb_build_object('kind',kind,'reasons',coalesce(sched->'reasons','[]'::jsonb),'conflicts',coalesce(sched->'conflicts','[]'::jsonb)),jsonb_build_object('sessions',snapshot,'forecastDate',active_plan.forecast_date,'completedThroughPage',old_completed),jsonb_build_object('candidate',p_candidate));
 if success then
  delete from public.schedule_sessions where id=any(eligible);
  insert into public.schedule_sessions(user_id,resource_id,plan_id,replan_run_id,plan_version,study_date,planned_workload,start_page,end_page,estimated_minutes)
  select owner_id,book.id,active_plan.id,run_id,version_after,(x->>'studyDate')::date,(x->>'pages')::integer,(x->>'startPage')::integer,(x->>'endPage')::integer,(x->>'estimatedMinutes')::integer from jsonb_array_elements(sched->'sessions') x;
 end if;
 update public.resources set progress_version=progress_version+1,replan_required=not success,status=case when completed=book.total_pages then 'COMPLETED'::public.resource_status else 'ACTIVE'::public.resource_status end where id=book.id;
 answer:=jsonb_build_object('submissionId',submission_id,'eventId',event_id,'runId',run_id,'completedThroughPage',completed,'progressVersion',book.progress_version+1,'planVersion',version_after,'replanStatus',case when success then 'applied' else 'pending' end,'forecastBefore',active_plan.forecast_date,'forecastAfter',forecast,'conflicts',coalesce(sched->'conflicts','[]'::jsonb),'reasons',coalesce(sched->'reasons','[]'::jsonb));
 insert into public.progress_submissions(id,user_id,idempotency_key,resource_id,request,result) values(submission_id,owner_id,key_id,book.id,p_request,answer);
 return answer;
end;
$$;
revoke all on function public.submit_book_progress(uuid,jsonb,jsonb,jsonb,integer,numeric,date) from public,anon;
grant execute on function public.submit_book_progress(uuid,jsonb,jsonb,jsonb,integer,numeric,date) to authenticated;
