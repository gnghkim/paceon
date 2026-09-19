-- 챕터로 공부하는 자료: 교재의 Unit, 강의의 강, 학습지의 회.
--
-- 책은 "N쪽까지"라는 숫자 하나로 진도를 말하고 앞에서부터만 읽는다. 교재와 강의는
-- 그렇지 않다. 순서대로 일정을 잡되 아무 챕터나 골라 공부할 수 있어야 하고, 그러면
-- 그 챕터는 남은 일정에서 빠져야 한다. 같은 챕터를 다시 공부할 수도 있다.
--
-- 책의 진도 저장은 진도가 앞에서부터 이어진다는 전제를 곳곳에서 검증한다. 거기에
-- "골라서"를 끼워 넣지 않고 나란한 길을 만든다. 표는 같은 것을 쓴다.
--   resource_units            챕터
--   progress_events.unit_id   챕터에 붙은 기록. 무효화되지 않은 학습 기록이 있으면 완료다
--   schedule_sessions.unit_id 챕터 하나의 일정
-- 완료 표시용 칼럼을 따로 두지 않는다. 기록이 곧 사실이고, 취소는 무효화 이벤트다.
--
-- 일정은 웹이 계산해 보내지 않고 여기서 직접 계산한다. 챕터형의 일정은 (남은 챕터,
-- 요일별 가용 시간, 다른 계획이 잡아 둔 시간, 하루 개수)의 순수한 결과라서, 사실이
-- 바뀔 때마다 같은 함수로 다시 계산하면 된다. 웹이 본 옛 일정과 어긋나 재시도하는
-- 흐름이 생기지 않는다.

alter table public.resources
  add column unit_label text check (unit_label is null or length(btrim(unit_label)) between 1 and 20);
comment on column public.resources.unit_label is
  '챕터를 부르는 말(Unit, 강, 회). 챕터형 자료에만 있다. 책은 끝까지 쪽이라고 말한다.';

-- 챕터로 기록과 일정을 찾는 색인은 처음부터 있다(progress_events_unit_idx, schedule_sessions_unit_idx).

-- 덮고 떠올린 것은 챕터에 붙는다. 자료 화면에서 챕터를 펼치면 그 챕터의 회상이 함께 보인다.
-- 앞면의 말은 저장할 때 적어 두므로, 챕터가 지워지면 카드도 함께 지운다.
alter table public.learning_expressions
  add column unit_id uuid,
  add constraint learning_expressions_unit_fk
    foreign key (unit_id, resource_id, user_id) references public.resource_units(id, resource_id, user_id)
    on delete cascade,
  add constraint learning_expressions_unit_needs_recall
    check (unit_id is null or kind = 'RECALL');
create index learning_expressions_unit_idx on public.learning_expressions(user_id, unit_id) where unit_id is not null;

/**
 * 챕터형 자료를 챕터와 함께 한 번에 만든다.
 *
 * p_input: { title, kind: 'COURSE'|'TEXTBOOK', unitLabel, author?, sourceUrl?,
 *            units: [{ title, minutes?, section? }] }
 * section이 참인 줄은 묶음 제목이다(강의의 섹션, 교재의 Part). 일정에 들어가지 않고
 * 뒤따르는 챕터들의 부모가 된다.
 */
create function public.create_unit_material(p_input jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  new_id uuid;
  item jsonb;
  position integer := 0;
  leaves integer := 0;
  current_section uuid;
  unit_id uuid;
  minutes integer;
  is_section boolean;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if jsonb_typeof(p_input) is distinct from 'object'
     or jsonb_typeof(p_input->'units') is distinct from 'array'
     or jsonb_array_length(p_input->'units') not between 1 and 2500
     or p_input->>'kind' is null or p_input->>'kind' not in ('COURSE', 'TEXTBOOK')
     or p_input->>'title' is null or length(btrim(p_input->>'title')) not between 1 and 500
     or p_input->>'unitLabel' is null or length(btrim(p_input->>'unitLabel')) not between 1 and 20
     or length(coalesce(p_input->>'author', '')) > 500
     or length(coalesce(p_input->>'sourceUrl', '')) > 2000 then
    raise exception 'Invalid material' using errcode = '23514';
  end if;
  select count(*) into leaves from jsonb_array_elements(p_input->'units') x
    where coalesce((x->>'section')::boolean, false) is not true;
  if leaves not between 1 and 2000 then raise exception 'Invalid unit count' using errcode = '23514'; end if;

  insert into public.resources(user_id, title, type, workload_unit, total_units, unit_label, author, source, source_id)
    values (owner_id, btrim(p_input->>'title'),
            case when p_input->>'kind' = 'COURSE' then 'COURSE'::public.resource_type else 'CUSTOM'::public.resource_type end,
            'UNIT', leaves, btrim(p_input->>'unitLabel'),
            nullif(btrim(coalesce(p_input->>'author', '')), ''),
            'MANUAL', nullif(btrim(coalesce(p_input->>'sourceUrl', '')), ''))
    returning id into new_id;

  for item in select value from jsonb_array_elements(p_input->'units') loop
    position := position + 1;
    is_section := coalesce((item->>'section')::boolean, false);
    if jsonb_typeof(item) is distinct from 'object'
       or item->>'title' is null or length(btrim(item->>'title')) not between 1 and 500 then
      raise exception 'Invalid unit' using errcode = '23514';
    end if;
    minutes := null;
    if item ? 'minutes' and item->'minutes' <> 'null'::jsonb then
      if jsonb_typeof(item->'minutes') <> 'number' or (item->>'minutes')::numeric <> trunc((item->>'minutes')::numeric)
         or (item->>'minutes')::integer not between 1 and 1440 then
        raise exception 'Invalid unit minutes' using errcode = '23514';
      end if;
      minutes := (item->>'minutes')::integer;
    end if;
    insert into public.resource_units(user_id, resource_id, parent_unit_id, title, sequence, unit_type, workload, estimated_minutes)
      values (owner_id, new_id, case when is_section then null else current_section end,
              btrim(item->>'title'), position,
              case when is_section then 'SECTION'::public.unit_type
                   when p_input->>'kind' = 'COURSE' then 'LECTURE'::public.unit_type
                   else 'UNIT'::public.unit_type end,
              case when is_section then null else 1 end,
              case when is_section then null else minutes end)
      returning id into unit_id;
    if is_section then current_section := unit_id; end if;
  end loop;
  return new_id;
end;
$$;
revoke all on function public.create_unit_material(jsonb) from public, anon;
grant execute on function public.create_unit_material(jsonb) to authenticated;

/**
 * 남은 챕터를 날짜에 다시 담는다. 챕터형 자료의 일정은 언제나 이 함수의 결과다.
 *
 * - 내일부터 담는다. 오늘 일정은 오늘의 약속이라 건드리지 않는다. 막 만든 계획만 오늘부터 담는다.
 * - 완료한 챕터와 오늘 일정에 아직 남아 있는 챕터는 담지 않는다.
 * - 그날의 가용 시간에서 다른 계획이 잡아 둔 시간을 뺀 만큼, 하루 개수 한도 안에서
 *   순서대로 담는다. 순서를 지키므로 앞 챕터가 안 들어가면 다음 날로 넘어간다.
 * - 어느 요일에도 안 들어가는 긴 챕터는 가장 여유 있는 요일의 빈 날에 혼자 두고,
 *   일정의 시간은 그날의 가용 시간으로 자른다. 책의 진도 저장이 "하루에 잡힌 시간의
 *   합은 가용 시간을 넘지 않는다"를 검증하기 때문이다. 실제 길이는 챕터에 남는다.
 *
 * p_dry_run이면 아무것도 쓰지 않고 결과만 돌려준다.
 */
create function public.replan_unit_plan(p_resource_id uuid, p_dry_run boolean default false) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  material public.resources;
  active_plan public.plans;
  today date;
  start_day date;
  day date;
  horizon date;
  unit_row record;
  occupied jsonb;
  placed_minutes jsonb := '{}'::jsonb;
  placed_count jsonb := '{}'::jsonb;
  capacities integer[] := array[0, 0, 0, 0, 0, 0, 0];
  max_capacity integer := 0;
  default_minutes integer;
  daily_limit integer;
  need integer;
  cap integer;
  busy integer;
  used integer;
  taken integer;
  booked integer;
  sessions jsonb := '[]'::jsonb;
  remaining integer := 0;
  done_count integer;
  last_day date;
  plan_version_now bigint;
  rule record;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  -- 책의 진도 저장과 같은 잠금을 쓴다. 같은 사람의 일정 계산이 서로 끼어들지 않는다.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4));
  select * into material from public.resources
    where id = p_resource_id and user_id = owner_id and workload_unit = 'UNIT' for no key update;
  if not found then raise exception 'Material not found' using errcode = '42501'; end if;
  select * into active_plan from public.plans
    where resource_id = material.id and user_id = owner_id and status in ('ACTIVE', 'PAUSED', 'COMPLETED')
    order by case status when 'ACTIVE' then 0 when 'PAUSED' then 1 else 2 end, created_at desc limit 1
    for no key update;
  if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;

  today := (now() at time zone active_plan.timezone)::date;
  select count(*) into done_count from public.resource_units u
    where u.resource_id = material.id and u.user_id = owner_id and u.unit_type <> 'SECTION'
      and exists (select 1 from public.progress_events e
                  where e.unit_id = u.id and e.user_id = owner_id and e.event_type = 'LEARNING'
                    and not exists (select 1 from public.progress_events v where v.voids_event_id = e.id));

  -- 멈춘 계획은 다시 담지 않는다. 멈춘 동안에도 잡아 둔 시간은 그대로 둔다. 책과 같다.
  if active_plan.status = 'PAUSED' then
    return jsonb_build_object('status', 'paused', 'done', done_count, 'total', material.total_units,
                              'forecastDate', active_plan.forecast_date, 'sessions', '[]'::jsonb, 'conflicts', '[]'::jsonb);
  end if;

  -- 막 만든 계획은 오늘부터 담을 수 있다. 그 뒤로는 내일부터다. 오늘 일정은 오늘의 약속이다.
  if exists (select 1 from public.schedule_sessions s where s.plan_id = active_plan.id) then
    start_day := greatest(active_plan.start_date, today + 1);
  else
    start_day := greatest(active_plan.start_date, today);
  end if;
  horizon := start_day + 3659;
  daily_limit := greatest(1, least(100, coalesce(active_plan.preferred_daily_workload, 1)::integer));
  default_minutes := greatest(1, least(1440, ceil(active_plan.minutes_per_page)::integer));
  for rule in select iso_weekday, available_minutes from public.availability_rules where user_id = owner_id loop
    capacities[rule.iso_weekday] := rule.available_minutes;
    max_capacity := greatest(max_capacity, rule.available_minutes);
  end loop;

  -- 다른 계획이 잡아 둔 시간. 이 계획의 옮길 수 있는 미래 일정은 지우고 새로 담을 것이라 세지 않는다.
  select coalesce(jsonb_object_agg(d, m), '{}'::jsonb) into occupied from (
    select s.study_date::text d, sum(coalesce(s.estimated_minutes, 1440)) m
    from public.schedule_sessions s join public.plans p on p.id = s.plan_id
    where s.user_id = owner_id and s.study_date between start_day and horizon
      and ((s.plan_id <> active_plan.id and p.status in ('ACTIVE', 'PAUSED') and s.status <> 'SKIPPED')
        or (s.plan_id = active_plan.id and (s.is_locked or s.status = 'COMPLETED')))
    group by s.study_date) o;

  day := start_day;
  for unit_row in
    select u.id, u.title, u.estimated_minutes from public.resource_units u
    where u.resource_id = material.id and u.user_id = owner_id and u.unit_type <> 'SECTION'
      and not exists (select 1 from public.progress_events e
                      where e.unit_id = u.id and e.user_id = owner_id and e.event_type = 'LEARNING'
                        and not exists (select 1 from public.progress_events v where v.voids_event_id = e.id))
      and not exists (select 1 from public.schedule_sessions s
                      where s.plan_id = active_plan.id and s.unit_id = u.id
                        and (s.study_date = today or (s.study_date > today and (s.is_locked or s.status = 'COMPLETED'))))
    order by u.sequence
  loop
    remaining := remaining + 1;
    if max_capacity <= 0 then
      return jsonb_build_object('status', 'conflict', 'done', done_count, 'total', material.total_units,
        'forecastDate', null, 'sessions', '[]'::jsonb, 'conflicts', jsonb_build_array(jsonb_build_object('code', 'NO_AVAILABILITY')));
    end if;
    need := coalesce(unit_row.estimated_minutes, default_minutes);
    loop
      if day > horizon then
        return jsonb_build_object('status', 'conflict', 'done', done_count, 'total', material.total_units,
          'forecastDate', null, 'sessions', '[]'::jsonb, 'conflicts', jsonb_build_array(jsonb_build_object('code', 'TIME_CAPACITY')));
      end if;
      cap := capacities[extract(isodow from day)::integer];
      busy := coalesce((occupied->>day::text)::integer, 0);
      used := coalesce((placed_minutes->>day::text)::integer, 0);
      taken := coalesce((placed_count->>day::text)::integer, 0);
      booked := null;
      if taken < daily_limit and cap > 0 then
        if need <= cap - busy - used then
          booked := need;
        elsif need > max_capacity and cap = max_capacity and busy = 0 and used = 0 then
          -- 어느 요일에도 안 들어가는 챕터. 가장 여유 있는 요일의 빈 날에 혼자 둔다.
          booked := cap;
        end if;
      end if;
      exit when booked is not null;
      day := day + 1;
    end loop;
    placed_minutes := jsonb_set(placed_minutes, array[day::text], to_jsonb(used + booked));
    placed_count := jsonb_set(placed_count, array[day::text], to_jsonb(taken + 1));
    sessions := sessions || jsonb_build_object('unitId', unit_row.id, 'title', unit_row.title,
                                               'studyDate', day, 'estimatedMinutes', booked);
    last_day := day;
  end loop;

  -- 오늘 일정에 남아 있는 챕터도 아직 할 일이다. 완료 판정과 예상일에 넣는다.
  select count(*) into taken from public.schedule_sessions s
    where s.plan_id = active_plan.id and s.study_date = today and s.unit_id is not null
      and not exists (select 1 from public.progress_events e
                      where e.unit_id = s.unit_id and e.user_id = owner_id and e.event_type = 'LEARNING'
                        and not exists (select 1 from public.progress_events v where v.voids_event_id = e.id));
  if taken > 0 and last_day is null then last_day := today; end if;
  remaining := remaining + taken;

  if p_dry_run then
    return jsonb_build_object('status', case when remaining = 0 then 'completed' else 'ok' end,
      'done', done_count, 'total', material.total_units, 'forecastDate', coalesce(last_day, today),
      'sessions', sessions, 'conflicts', '[]'::jsonb);
  end if;

  delete from public.schedule_sessions s
    where s.plan_id = active_plan.id and s.study_date > today and not s.is_locked and s.status <> 'COMPLETED';
  update public.plans set forecast_date = greatest(coalesce(last_day, today), start_date),
      status = case when remaining = 0 then 'COMPLETED'::public.plan_status else 'ACTIVE'::public.plan_status end
    where id = active_plan.id;
  select version into plan_version_now from public.plans where id = active_plan.id;
  insert into public.schedule_sessions(user_id, resource_id, plan_id, unit_id, plan_version, study_date, planned_workload, estimated_minutes)
    select owner_id, material.id, active_plan.id, (x->>'unitId')::uuid, plan_version_now,
           (x->>'studyDate')::date, 1, (x->>'estimatedMinutes')::integer
    from jsonb_array_elements(sessions) x;
  -- 지난 날과 오늘의 일정은 그 챕터를 했는지에 따라 상태를 맞춘다.
  update public.schedule_sessions s set status = case
      when exists (select 1 from public.progress_events e
                   where e.unit_id = s.unit_id and e.user_id = owner_id and e.event_type = 'LEARNING'
                     and not exists (select 1 from public.progress_events v where v.voids_event_id = e.id))
        then 'COMPLETED'::public.session_status
      when s.study_date < today then 'SKIPPED'::public.session_status
      else 'PLANNED'::public.session_status end
    where s.plan_id = active_plan.id and s.unit_id is not null and s.study_date <= today;
  update public.resources set replan_required = false,
      status = case when remaining = 0 then 'COMPLETED'::public.resource_status
                    when status = 'ARCHIVED' then status else 'ACTIVE'::public.resource_status end
    where id = material.id;

  return jsonb_build_object('status', case when remaining = 0 then 'completed' else 'ok' end,
    'done', done_count, 'total', material.total_units, 'forecastDate', coalesce(last_day, today),
    'sessions', sessions, 'conflicts', '[]'::jsonb);
end;
$$;
revoke all on function public.replan_unit_plan(uuid, boolean) from public, anon;
grant execute on function public.replan_unit_plan(uuid, boolean) to authenticated;

/**
 * 계획을 만들거나 하루 분량을 바꾼다.
 * p_options: { startDate?, timezone?, dailyUnits, minutesPerUnit }
 * 계획이 없으면 만들고, 있으면 하루 개수와 챕터당 기본 시간을 바꾼 뒤 다시 담는다.
 */
create function public.plan_unit_material(p_resource_id uuid, p_options jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  material public.resources;
  existing public.plans;
  goal_id uuid;
  zone text := coalesce(p_options->>'timezone', 'Asia/Seoul');
  start_day date;
  daily integer;
  per_unit numeric;
  answer jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4));
  select * into material from public.resources
    where id = p_resource_id and user_id = owner_id and workload_unit = 'UNIT' for no key update;
  if not found then raise exception 'Material not found' using errcode = '42501'; end if;
  if material.status = 'ARCHIVED' then raise exception 'Material is archived' using errcode = '23514'; end if;
  if jsonb_typeof(p_options) is distinct from 'object'
     or jsonb_typeof(p_options->'dailyUnits') is distinct from 'number'
     or jsonb_typeof(p_options->'minutesPerUnit') is distinct from 'number'
     or (p_options->>'dailyUnits')::numeric <> trunc((p_options->>'dailyUnits')::numeric)
     or (p_options->>'dailyUnits')::integer not between 1 and 100
     or (p_options->>'minutesPerUnit')::numeric not between 1 and 1440
     or not private.valid_timezone(zone) then
    raise exception 'Invalid plan options' using errcode = '23514';
  end if;
  daily := (p_options->>'dailyUnits')::integer;
  per_unit := (p_options->>'minutesPerUnit')::numeric;

  select * into existing from public.plans
    where resource_id = material.id and user_id = owner_id and status in ('ACTIVE', 'PAUSED', 'COMPLETED')
    order by case status when 'ACTIVE' then 0 when 'PAUSED' then 1 else 2 end, created_at desc limit 1;
  if found then
    update public.plans set preferred_daily_workload = daily, minutes_per_page = per_unit, mode = 'PACE'
      where id = existing.id;
    update public.goals set preferred_daily_workload = daily, mode = 'PACE' where id = existing.goal_id;
  else
    start_day := coalesce((p_options->>'startDate')::date, (now() at time zone zone)::date);
    if not isfinite(start_day) or start_day < (now() at time zone zone)::date - 1
       or start_day > (now() at time zone zone)::date + 3660 then
      raise exception 'Invalid start date' using errcode = '23514';
    end if;
    insert into public.goals(user_id, resource_id, title, start_date, mode, preferred_daily_workload)
      values (owner_id, material.id, material.title, start_day, 'PACE', daily) returning id into goal_id;
    insert into public.plans(user_id, resource_id, goal_id, mode, start_date, timezone, preferred_daily_workload, minutes_per_page)
      values (owner_id, material.id, goal_id, 'PACE', start_day, zone, daily, per_unit);
  end if;
  answer := public.replan_unit_plan(material.id, false);
  if answer->>'status' = 'conflict' then
    -- 담지 못한 계획을 남기지 않는다. 가용 시간을 고친 뒤 다시 만들게 한다.
    raise exception 'UNIT_PLAN_CONFLICT:%', answer->'conflicts'->0->>'code' using errcode = 'P0001';
  end if;
  return answer;
end;
$$;
revoke all on function public.plan_unit_material(uuid, jsonb) from public, anon;
grant execute on function public.plan_unit_material(uuid, jsonb) to authenticated;

/**
 * 챕터 하나에 대한 기록.
 *
 * p_request: { kind, unitId, idempotencyKey, studyDate?, durationMinutes?, memo? }
 *   COMPLETE  그 챕터를 공부했다. 순서와 상관없이 아무 챕터나 된다. 남은 일정에서 빠진다.
 *   REPEAT    이미 한 챕터를 다시 공부했다. 완료 여부는 바뀌지 않고 시간과 내용만 남는다.
 *   UNDO      완료를 취소한다. 기록을 지우지 않고 무효화 이벤트를 더한다. 일정에 돌아온다.
 * 같은 멱등 키로 다시 부르면 처음의 답을 그대로 돌려준다.
 */
create function public.submit_unit_progress(p_resource_id uuid, p_request jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  material public.resources;
  active_plan public.plans;
  prior public.progress_submissions;
  target public.resource_units;
  learned public.progress_events;
  kind text := p_request->>'kind';
  key_id uuid;
  study_day date;
  today date;
  duration integer;
  event_id uuid;
  session_ref uuid;
  submission_id uuid := gen_random_uuid();
  plan_result jsonb;
  answer jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 4));
  if jsonb_typeof(p_request) is distinct from 'object' or kind is null or kind not in ('COMPLETE', 'REPEAT', 'UNDO')
     or exists (select 1 from jsonb_object_keys(p_request) k
                where k not in ('kind', 'unitId', 'idempotencyKey', 'studyDate', 'durationMinutes', 'memo')) then
    raise exception 'Invalid progress request' using errcode = '23514';
  end if;
  key_id := (p_request->>'idempotencyKey')::uuid;
  if key_id is null then raise exception 'Invalid progress request' using errcode = '23514'; end if;
  select * into prior from public.progress_submissions where user_id = owner_id and idempotency_key = key_id;
  if found then
    if prior.resource_id <> p_resource_id or prior.request is distinct from p_request then
      raise exception 'Idempotency key reused' using errcode = '40001';
    end if;
    return prior.result;
  end if;

  select * into material from public.resources
    where id = p_resource_id and user_id = owner_id and workload_unit = 'UNIT' for no key update;
  if not found then raise exception 'Material not found' using errcode = '42501'; end if;
  if material.status = 'ARCHIVED' then raise exception 'Material is archived' using errcode = '23514'; end if;
  select * into active_plan from public.plans
    where resource_id = material.id and user_id = owner_id and status in ('ACTIVE', 'PAUSED', 'COMPLETED')
    order by case status when 'ACTIVE' then 0 when 'PAUSED' then 1 else 2 end, created_at desc limit 1;
  if not found then raise exception 'Plan not found' using errcode = 'P0002'; end if;
  select * into target from public.resource_units
    where id = (p_request->>'unitId')::uuid and resource_id = material.id and user_id = owner_id and unit_type <> 'SECTION';
  if not found then raise exception 'Unit not found' using errcode = '42501'; end if;

  today := (now() at time zone active_plan.timezone)::date;
  study_day := coalesce((p_request->>'studyDate')::date, today);
  if not isfinite(study_day) or study_day > today or study_day < today - 3660 then
    raise exception 'Invalid study date' using errcode = '23514';
  end if;
  if p_request ? 'durationMinutes' and p_request->'durationMinutes' <> 'null'::jsonb then
    if jsonb_typeof(p_request->'durationMinutes') <> 'number'
       or (p_request->>'durationMinutes')::numeric <> trunc((p_request->>'durationMinutes')::numeric)
       or (p_request->>'durationMinutes')::integer not between 0 and 1440 then
      raise exception 'Invalid duration' using errcode = '23514';
    end if;
    duration := (p_request->>'durationMinutes')::integer;
  end if;
  if length(coalesce(p_request->>'memo', '')) > 10000 then raise exception 'Memo too long' using errcode = '23514'; end if;

  select e.* into learned from public.progress_events e
    where e.unit_id = target.id and e.user_id = owner_id and e.event_type = 'LEARNING'
      and not exists (select 1 from public.progress_events v where v.voids_event_id = e.id)
    order by e.created_at desc limit 1;

  if kind = 'COMPLETE' then
    if learned.id is not null then raise exception 'Unit already completed' using errcode = '23505'; end if;
    -- 그날 그 챕터의 일정이 있었다면 기록을 거기에 잇는다.
    select s.id into session_ref from public.schedule_sessions s
      where s.plan_id = active_plan.id and s.unit_id = target.id and s.study_date = study_day limit 1;
    insert into public.progress_events(user_id, resource_id, unit_id, session_id, event_type, study_date, timezone,
                                       completed_workload, duration_minutes, memo, idempotency_key)
      values (owner_id, material.id, target.id, session_ref, 'LEARNING', study_day, active_plan.timezone,
              1, duration, nullif(btrim(coalesce(p_request->>'memo', '')), ''), key_id)
      returning id into event_id;
  elsif kind = 'REPEAT' then
    if learned.id is null then raise exception 'Unit not completed yet' using errcode = '23514'; end if;
    insert into public.progress_events(user_id, resource_id, unit_id, event_type, study_date, timezone,
                                       completed_workload, duration_minutes, memo, idempotency_key)
      values (owner_id, material.id, target.id, 'REVIEW', study_day, active_plan.timezone,
              1, duration, nullif(btrim(coalesce(p_request->>'memo', '')), ''), key_id)
      returning id into event_id;
  else
    if learned.id is null then raise exception 'Unit not completed yet' using errcode = '23514'; end if;
    if p_request ?| array['durationMinutes', 'memo'] then raise exception 'Invalid request fields' using errcode = '23514'; end if;
    insert into public.progress_events(user_id, resource_id, event_type, study_date, timezone,
                                       completed_workload, idempotency_key, voids_event_id)
      values (owner_id, material.id, 'VOID', study_day, active_plan.timezone, 0, key_id, learned.id)
      returning id into event_id;
  end if;

  update public.resources set progress_version = progress_version + 1 where id = material.id;
  plan_result := public.replan_unit_plan(material.id, false);
  if plan_result->>'status' = 'conflict' then
    -- 기록은 남긴다. 일정만 나중에 다시 담는다.
    update public.resources set replan_required = true where id = material.id;
  end if;
  answer := jsonb_build_object('submissionId', submission_id, 'eventId', event_id, 'kind', kind, 'unitId', target.id,
    'done', plan_result->'done', 'total', plan_result->'total', 'forecastDate', plan_result->'forecastDate',
    'replanStatus', case when plan_result->>'status' = 'conflict' then 'pending' else 'applied' end,
    'conflicts', plan_result->'conflicts', 'progressVersion', material.progress_version + 1);
  insert into public.progress_submissions(id, user_id, idempotency_key, resource_id, request, result)
    values (submission_id, owner_id, key_id, material.id, p_request, answer);
  return answer;
end;
$$;
revoke all on function public.submit_unit_progress(uuid, jsonb) from public, anon;
grant execute on function public.submit_unit_progress(uuid, jsonb) to authenticated;
