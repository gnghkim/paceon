-- Phase 1: persisted contracts only; scheduling and atomic replan RPC follow later.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.resource_type as enum ('BOOK','PDF','COURSE','VIDEO','CUSTOM');
create type public.workload_unit as enum ('PAGE','UNIT','MINUTE');
create type public.resource_status as enum ('ACTIVE','COMPLETED','ARCHIVED');
create type public.unit_type as enum ('CHAPTER','SECTION','UNIT','PAGE_RANGE','LECTURE','VIDEO','CUSTOM');
create type public.plan_mode as enum ('DEADLINE','PACE','BALANCED');
create type public.plan_status as enum ('ACTIVE','PAUSED','COMPLETED','ARCHIVED');
create type public.session_status as enum ('PLANNED','IN_PROGRESS','COMPLETED','SKIPPED');
create type public.progress_event_type as enum ('LEARNING','REVIEW','VOID');
create type public.replan_status as enum ('APPLIED','SKIPPED','FAILED');

create function private.valid_timezone(value text) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from pg_catalog.pg_timezone_names where name = value);
$$;
revoke all on function private.valid_timezone(text) from public;
grant execute on function private.valid_timezone(text) to authenticated, service_role;

create table public.learner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone text not null default 'Asia/Seoul' check (private.valid_timezone(timezone)),
  preferred_time time,
  average_session_minutes numeric(10,3) check (average_session_minutes between 0 and 1000000),
  pages_per_minute numeric(10,3) check (pages_per_minute > 0 and pages_per_minute < 1000000),
  units_per_hour numeric(10,3) check (units_per_hour > 0 and units_per_hour < 1000000),
  completion_rate numeric(4,3) check (completion_rate between 0 and 1),
  workload_multiplier numeric(8,3) not null default 1 check (workload_multiplier > 0 and workload_multiplier < 10000),
  speed_sample_count integer not null default 0 check (speed_sample_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  type public.resource_type not null,
  workload_unit public.workload_unit not null default 'PAGE',
  author text,
  publisher text,
  isbn text,
  source text not null default 'MANUAL',
  source_id text,
  cover_url text,
  total_pages integer check (total_pages > 0),
  total_units integer check (total_units > 0),
  initial_completed_workload numeric(12,3) not null default 0 check (initial_completed_workload between 0 and 999999999),
  status public.resource_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,user_id),
  check (type <> 'BOOK' or (workload_unit = 'PAGE' and total_pages is not null)),
  check (workload_unit <> 'PAGE' or (total_pages is not null and initial_completed_workload <= total_pages and initial_completed_workload = trunc(initial_completed_workload))),
  check (workload_unit <> 'UNIT' or (total_units is not null and initial_completed_workload <= total_units and initial_completed_workload = trunc(initial_completed_workload)))
);
create index resources_owner_status_idx on public.resources(user_id,status);

create table public.resource_units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  parent_unit_id uuid,
  title text not null check (length(btrim(title)) between 1 and 500),
  sequence integer not null check (sequence > 0),
  unit_type public.unit_type not null,
  start_page integer,
  end_page integer,
  workload numeric(12,3) check (workload > 0 and workload < 1000000000),
  estimated_minutes integer check (estimated_minutes > 0),
  difficulty numeric(4,3) check (difficulty between 0 and 1),
  importance numeric(4,3) check (importance between 0 and 1),
  ai_confidence numeric(4,3) check (ai_confidence between 0 and 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,resource_id,user_id),
  unique (user_id,resource_id,sequence),
  foreign key (resource_id,user_id) references public.resources(id,user_id),
  foreign key (parent_unit_id,resource_id,user_id) references public.resource_units(id,resource_id,user_id),
  check (parent_unit_id is distinct from id),
  check ((start_page is null and end_page is null) or (start_page is not null and end_page is not null and start_page > 0 and end_page >= start_page))
);
create index resource_units_owner_idx on public.resource_units(user_id,resource_id);
create index resource_units_parent_idx on public.resource_units(parent_unit_id,resource_id,user_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 500),
  start_date date not null check (isfinite(start_date)),
  target_date date check (isfinite(target_date)),
  mode public.plan_mode not null default 'BALANCED',
  preferred_daily_workload numeric(12,3) check (preferred_daily_workload > 0 and preferred_daily_workload < 1000000000),
  status public.plan_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,resource_id,user_id),
  foreign key (resource_id,user_id) references public.resources(id,user_id),
  check (target_date is null or target_date >= start_date),
  check (mode <> 'DEADLINE' or target_date is not null),
  check (mode not in ('PACE','BALANCED') or preferred_daily_workload is not null)
);
create index goals_owner_resource_idx on public.goals(user_id,resource_id);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  iso_weekday smallint not null check (iso_weekday between 1 and 7),
  available_minutes integer not null check (available_minutes between 1 and 1440),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,iso_weekday)
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  goal_id uuid not null,
  mode public.plan_mode not null default 'BALANCED',
  start_date date not null check (isfinite(start_date)),
  target_date date check (isfinite(target_date)),
  forecast_date date check (isfinite(forecast_date)),
  timezone text not null default 'Asia/Seoul' check (private.valid_timezone(timezone)),
  preferred_daily_workload numeric(12,3) check (preferred_daily_workload > 0 and preferred_daily_workload < 1000000000),
  version bigint not null default 1 check (version > 0),
  status public.plan_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,resource_id,user_id),
  foreign key (resource_id,user_id) references public.resources(id,user_id),
  foreign key (goal_id,resource_id,user_id) references public.goals(id,resource_id,user_id),
  check (target_date is null or target_date >= start_date),
  check (forecast_date is null or forecast_date >= start_date),
  check (mode <> 'DEADLINE' or target_date is not null),
  check (mode not in ('PACE','BALANCED') or preferred_daily_workload is not null)
);
create unique index plans_one_active_resource_idx on public.plans(user_id,resource_id) where status in ('ACTIVE','PAUSED');
create index plans_goal_idx on public.plans(goal_id,resource_id,user_id);

create table public.replan_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  plan_id uuid not null,
  idempotency_key uuid not null,
  status public.replan_status not null,
  from_version bigint not null check (from_version > 0),
  to_version bigint not null check (to_version > 0),
  policy_version text not null check (length(btrim(policy_version)) between 1 and 100),
  reason jsonb not null check (jsonb_typeof(reason) = 'object'),
  before_snapshot jsonb not null default '{}' check (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb not null default '{}' check (jsonb_typeof(after_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique (id,plan_id,resource_id,user_id),
  unique (user_id,idempotency_key),
  foreign key (plan_id,resource_id,user_id) references public.plans(id,resource_id,user_id),
  check ((status = 'APPLIED' and to_version = from_version + 1) or (status <> 'APPLIED' and to_version = from_version))
);
create unique index replan_runs_applied_version_idx on public.replan_runs(user_id,plan_id,to_version) where status = 'APPLIED';
create index replan_runs_owner_idx on public.replan_runs(user_id,plan_id,created_at);

create table public.schedule_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  plan_id uuid not null,
  unit_id uuid,
  replan_run_id uuid,
  plan_version bigint not null default 1 check (plan_version > 0),
  study_date date not null check (isfinite(study_date)),
  planned_workload numeric(12,3) not null check (planned_workload > 0 and planned_workload < 1000000000),
  start_page integer,
  end_page integer,
  estimated_minutes integer check (estimated_minutes > 0),
  status public.session_status not null default 'PLANNED',
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,resource_id,user_id),
  foreign key (plan_id,resource_id,user_id) references public.plans(id,resource_id,user_id),
  foreign key (unit_id,resource_id,user_id) references public.resource_units(id,resource_id,user_id),
  foreign key (replan_run_id,plan_id,resource_id,user_id) references public.replan_runs(id,plan_id,resource_id,user_id),
  check ((start_page is null and end_page is null) or (start_page is not null and end_page is not null and start_page > 0 and end_page >= start_page and planned_workload = end_page::numeric - start_page + 1))
);
create index schedule_sessions_plan_date_idx on public.schedule_sessions(plan_id,study_date);
create index schedule_sessions_owner_date_idx on public.schedule_sessions(user_id,study_date);
create index schedule_sessions_unit_idx on public.schedule_sessions(unit_id,resource_id,user_id);
create index schedule_sessions_replan_idx on public.schedule_sessions(replan_run_id,plan_id,resource_id,user_id);

create table public.progress_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  unit_id uuid,
  session_id uuid,
  event_type public.progress_event_type not null default 'LEARNING',
  study_date date not null check (isfinite(study_date)),
  timezone text not null default 'Asia/Seoul' check (private.valid_timezone(timezone)),
  started_at timestamptz check (isfinite(started_at)),
  completed_at timestamptz check (isfinite(completed_at)),
  start_page integer,
  end_page integer,
  completed_workload numeric(12,3) not null check (completed_workload between 0 and 999999999),
  duration_minutes integer check (duration_minutes >= 0),
  difficulty_feedback smallint check (difficulty_feedback between 1 and 5),
  memo text check (length(memo) <= 10000),
  idempotency_key uuid not null,
  voids_event_id uuid,
  created_at timestamptz not null default now(),
  unique (id,resource_id,user_id),
  unique (user_id,idempotency_key),
  unique (user_id,voids_event_id),
  foreign key (resource_id,user_id) references public.resources(id,user_id),
  foreign key (unit_id,resource_id,user_id) references public.resource_units(id,resource_id,user_id),
  foreign key (session_id,resource_id,user_id) references public.schedule_sessions(id,resource_id,user_id),
  foreign key (voids_event_id,resource_id,user_id) references public.progress_events(id,resource_id,user_id),
  check (voids_event_id is distinct from id),
  check (completed_at is null or started_at is null or completed_at >= started_at),
  check ((start_page is null and end_page is null) or (start_page is not null and end_page is not null and start_page > 0 and end_page >= start_page and completed_workload = end_page::numeric - start_page + 1)),
  check ((event_type = 'VOID' and voids_event_id is not null and completed_workload = 0 and duration_minutes is null and start_page is null and end_page is null and unit_id is null and session_id is null)
      or (event_type <> 'VOID' and voids_event_id is null and completed_workload > 0))
);
create index progress_events_owner_date_idx on public.progress_events(user_id,study_date);
create index progress_events_resource_idx on public.progress_events(resource_id,user_id,created_at);
create index progress_events_session_idx on public.progress_events(session_id,resource_id,user_id);
create index progress_events_unit_idx on public.progress_events(unit_id,resource_id,user_id);

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function private.advance_plan_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 then raise exception 'A plan starts at version 1' using errcode = '23514'; end if;
  else
    if new.version <> old.version then raise exception 'Plan version is server maintained' using errcode = '23514'; end if;
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create trigger plans_version before insert or update on public.plans
for each row execute function private.advance_plan_version();

create function private.validate_resource_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.initial_completed_workload,new.workload_unit) is distinct from (old.initial_completed_workload,old.workload_unit)
    and exists(select 1 from public.progress_events where resource_id=old.id and user_id=old.user_id) then
    raise exception 'Initial progress and unit cannot change after events' using errcode = '23514';
  end if;
  if (new.total_pages,new.workload_unit) is distinct from (old.total_pages,old.workload_unit) and (
    exists(select 1 from public.resource_units where resource_id=old.id and end_page is not null and (new.workload_unit <> 'PAGE' or end_page > coalesce(new.total_pages,0))) or
    exists(select 1 from public.schedule_sessions where resource_id=old.id and end_page is not null and (new.workload_unit <> 'PAGE' or end_page > coalesce(new.total_pages,0))) or
    exists(select 1 from public.progress_events where resource_id=old.id and end_page is not null and (new.workload_unit <> 'PAGE' or end_page > coalesce(new.total_pages,0)))) then
    raise exception 'Resource changes cannot invalidate existing page ranges' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger resources_validate before update on public.resources
for each row execute function private.validate_resource_change();

create function private.validate_resource_child() returns trigger
language plpgsql set search_path = '' as $$
declare
  resource_row public.resources;
  parent_kind public.progress_event_type;
  current_version bigint;
begin
  -- Serialize metadata changes while remaining compatible with FK KEY SHARE locks.
  select * into resource_row from public.resources where id=new.resource_id and user_id=new.user_id for no key update;
  if not found then raise exception 'Resource reference does not exist' using errcode = '23503'; end if;
  if new.end_page is not null and (resource_row.workload_unit <> 'PAGE' or new.end_page > resource_row.total_pages) then
    raise exception 'Page range is outside resource bounds' using errcode = '23514';
  end if;
  if tg_table_name = 'resource_units' then
    if new.parent_unit_id is not null and exists(
      with recursive ancestors as (
        select id,parent_unit_id from public.resource_units where id=new.parent_unit_id and resource_id=new.resource_id and user_id=new.user_id
        union
        select u.id,u.parent_unit_id from public.resource_units u join ancestors a on u.id=a.parent_unit_id
        where u.resource_id=new.resource_id and u.user_id=new.user_id
      ) select 1 from ancestors where id=new.id
    ) then raise exception 'Unit hierarchy cannot contain cycles' using errcode = '23514'; end if;
  elsif tg_table_name = 'schedule_sessions' then
    select version into current_version from public.plans where id=new.plan_id and resource_id=new.resource_id and user_id=new.user_id;
    if new.plan_version > current_version then raise exception 'Session cannot reference a future plan version' using errcode = '23514'; end if;
  elsif tg_table_name = 'progress_events' and new.event_type = 'VOID' then
    select event_type into parent_kind from public.progress_events where id=new.voids_event_id and resource_id=new.resource_id and user_id=new.user_id;
    if parent_kind = 'VOID' then raise exception 'Cannot void a VOID event' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;

create function private.prevent_history_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'History is append-only' using errcode = '42501';
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['learner_profiles','resources','resource_units','goals','availability_rules','plans','schedule_sessions','progress_events','replan_runs'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from anon, authenticated',table_name);
    execute format('grant select, insert on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
    execute format('create policy owner_select on public.%I for select to authenticated using ((select auth.uid()) = user_id)',table_name);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',table_name);
    if table_name not in ('progress_events','replan_runs') then
      execute format('grant update, delete on public.%I to authenticated',table_name);
      execute format('create policy owner_update on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',table_name);
      execute format('create policy owner_delete on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',table_name);
      execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',table_name);
    else
      execute format('create trigger immutable_history before update on public.%I for each row execute function private.prevent_history_update()',table_name);
    end if;
  end loop;
  foreach table_name in array array['resource_units','schedule_sessions','progress_events'] loop
    -- AFTER sees every row of a bulk INSERT/UPDATE, including forward references.
    execute format('create trigger validate_resource_child after insert or update on public.%I for each row execute function private.validate_resource_child()',table_name);
  end loop;
end;
$$;

revoke all on all functions in schema private from public;
grant execute on function private.valid_timezone(text) to authenticated, service_role;
-- Other private functions are trigger-only and need no direct caller EXECUTE grant.
