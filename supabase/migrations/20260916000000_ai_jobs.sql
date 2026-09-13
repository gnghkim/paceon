-- Durable advisory AI queue. Browsers can only read their own jobs.
create table public.ai_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 resource_id uuid not null,
 kind text not null check(kind in ('BOOK_ANALYSIS','COACH')),
 status text not null default 'PENDING' check(status in ('PENDING','PROCESSING','COMPLETED','FAILED')),
 input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=100000),
 source_revision text not null check(source_revision ~ '^[a-f0-9]{64}$'),
 result jsonb, model text, provider_response_id text,
 input_tokens integer check(input_tokens>=0), output_tokens integer check(output_tokens>=0),
 error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(resource_id,user_id) references public.resources(id,user_id) on delete cascade,
 check((status='PROCESSING')=(lease_token is not null and lease_expires_at is not null)),
 check((status='COMPLETED')=(result is not null)),
 check((status='FAILED')=(error_code is not null))
);
create unique index ai_jobs_active on public.ai_jobs(resource_id,kind) where status in ('PENDING','PROCESSING');
create index ai_jobs_owner_recent on public.ai_jobs(user_id,resource_id,created_at desc);
create index ai_jobs_claim on public.ai_jobs(created_at) where status in ('PENDING','PROCESSING');
alter table public.ai_jobs enable row level security;
revoke all on public.ai_jobs from public,anon,authenticated;
grant select on public.ai_jobs to authenticated;
grant all on public.ai_jobs to service_role;
create policy ai_jobs_owner_read on public.ai_jobs for select to authenticated using((select auth.uid())=user_id);

create function private.valid_ai_input(v jsonb,k text,r text) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare f jsonb; b jsonb; item jsonb; name text; n numeric;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>100000 then return false; end if;
 if not(v ?& array['schemaVersion','kind','book','outline','facts','sourceRevision']) or v-array['schemaVersion','kind','book','outline','facts','sourceRevision']<>'{}'::jsonb
  or v->'schemaVersion'<>'1'::jsonb or v->>'kind' is distinct from k or v->>'sourceRevision' is distinct from r
  or jsonb_typeof(v->'outline') is distinct from 'string' or length(v->>'outline')>12000 then return false; end if;
 b:=v->'book'; f:=v->'facts';
 if jsonb_typeof(b) is distinct from 'object' or not(b ?& array['title','authors','totalPages','description']) or b-array['title','authors','totalPages','description']<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(b->'title') is distinct from 'string' or length(b->>'title') not between 1 and 500
  or jsonb_typeof(b->'description') is distinct from 'string' or length(b->>'description')>4000
  or jsonb_typeof(b->'authors') is distinct from 'array' then return false; end if;
 if jsonb_array_length(b->'authors')>20 then return false; end if;
 for item in select value from jsonb_array_elements(b->'authors') loop
  if jsonb_typeof(item)<>'string' or length(item#>>'{}')>200 then return false; end if;
 end loop;
 if jsonb_typeof(b->'totalPages') is distinct from 'number' then return false; end if;
 n:=(b->>'totalPages')::numeric;
 if n<>trunc(n) or n not between 1 and 2147483647 then return false; end if;
 if jsonb_typeof(f) is distinct from 'object' or not(f ?& array['today','completedPages','remainingPages','progressPercent','planMode','forecastDate','targetDate','replanRequired','recentLearningPages','recentLearningMinutes','validTimedSamples'])
  or f-array['today','completedPages','remainingPages','progressPercent','planMode','forecastDate','targetDate','replanRequired','recentLearningPages','recentLearningMinutes','validTimedSamples']<>'{}'::jsonb then return false; end if;
 foreach name in array array['completedPages','remainingPages','progressPercent','recentLearningPages','recentLearningMinutes','validTimedSamples'] loop
  if jsonb_typeof(f->name) is distinct from 'number' then return false; end if;
  n:=(f->>name)::numeric;
  if n<>trunc(n) or n not between 0 and 2147483647 then return false; end if;
 end loop;
 if (f->>'progressPercent')::numeric>100 or jsonb_typeof(f->'replanRequired') is distinct from 'boolean' then return false; end if;
 foreach name in array array['today','forecastDate','targetDate'] loop
  if name<>'today' and f->name='null'::jsonb then continue; end if;
  if jsonb_typeof(f->name) is distinct from 'string' or (f->>name)!~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform (f->>name)::date;
 end loop;
 if f->'planMode'<>'null'::jsonb and (jsonb_typeof(f->'planMode')<>'string' or length(f->>'planMode')>40) then return false; end if;
 return true;
exception when others then return false;
end; $$;
revoke all on function private.valid_ai_input(jsonb,text,text) from public,anon,authenticated;

create function private.valid_ai_result(v jsonb,k text) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare item jsonb; a jsonb; n numeric;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>20000 then return false; end if;
 if jsonb_typeof(v->'confidence') is distinct from 'number' or jsonb_typeof(v->'summary') is distinct from 'string' then return false; end if;
 if (v->>'confidence')::numeric not between 0 and 1 then return false; end if;
 if k='BOOK_ANALYSIS' then
  if not(v ?& array['difficulty','estimatedMinutes','importance','confidence','summary','reasons']) or v-array['difficulty','estimatedMinutes','importance','confidence','summary','reasons']<>'{}'::jsonb
   or v->>'difficulty' not in ('EASY','MODERATE','CHALLENGING') or v->>'importance' not in ('LOW','MEDIUM','HIGH')
   or jsonb_typeof(v->'difficulty') is distinct from 'string' or jsonb_typeof(v->'importance') is distinct from 'string'
   or jsonb_typeof(v->'estimatedMinutes') is distinct from 'number' or length(v->>'summary') not between 1 and 600 then return false; end if;
  n:=(v->>'estimatedMinutes')::numeric;
  if n<>trunc(n) or n not between 1 and 10000000 then return false; end if;
  a:=v->'reasons';
 else
  if not(v ?& array['summary','suggestions','confidence']) or v-array['summary','suggestions','confidence']<>'{}'::jsonb or length(v->>'summary') not between 1 and 800 then return false; end if;
  a:=v->'suggestions';
 end if;
 if jsonb_typeof(a) is distinct from 'array' then return false; end if;
 if jsonb_array_length(a) not between 1 and (case when k='BOOK_ANALYSIS' then 4 else 3 end) then return false; end if;
 for item in select value from jsonb_array_elements(a) loop
  if jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 1 and 300 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;
revoke all on function private.valid_ai_result(jsonb,text) from public,anon,authenticated;
grant execute on function private.valid_ai_result(jsonb,text) to service_role;

create function public.enqueue_ai_job(p_resource_id uuid,p_kind text,p_input jsonb,p_source_revision text) returns uuid
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); job_id uuid;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('BOOK_ANALYSIS','COACH') or p_source_revision is null or p_source_revision!~'^[a-f0-9]{64}$'
  or not private.valid_ai_input(p_input,p_kind,p_source_revision) then raise exception 'Invalid AI input' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,6));
 perform 1 from public.resources where id=p_resource_id and user_id=owner_id and type='BOOK' for key share;
 if not found then raise exception 'Book not found' using errcode='42501'; end if;
 select id into job_id from public.ai_jobs where resource_id=p_resource_id and kind=p_kind and status in ('PENDING','PROCESSING') limit 1;
 if found then return job_id; end if;
 select id into job_id from public.ai_jobs where resource_id=p_resource_id and kind=p_kind and status='COMPLETED' and source_revision=p_source_revision order by created_at desc limit 1;
 if found then
  -- A reused revision becomes the latest requested context, even after A -> B -> A.
  update public.ai_jobs set updated_at=clock_timestamp() where id=job_id;
  return job_id;
 end if;
 if (select count(*) from public.ai_jobs where user_id=owner_id and status in ('PENDING','PROCESSING'))>=5 then raise exception 'AI queue full' using errcode='PT429'; end if;
 insert into public.ai_jobs(user_id,resource_id,kind,input,source_revision) values(owner_id,p_resource_id,p_kind,p_input,p_source_revision) returning id into job_id;
 return job_id;
end; $$;
revoke all on function public.enqueue_ai_job(uuid,text,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_ai_job(uuid,text,jsonb,text) to authenticated;

create function public.claim_ai_job() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.ai_jobs;
begin
 loop
  select * into job from public.ai_jobs where status='PENDING' or (status='PROCESSING' and lease_expires_at<=clock_timestamp()) order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  if job.attempts>=3 then
   update public.ai_jobs set status='FAILED',error_code='WORKER_TIMEOUT',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=job.id;
   continue;
  end if;
  update public.ai_jobs set status='PROCESSING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() where id=job.id returning * into job;
  return to_jsonb(job);
 end loop;
end; $$;
revoke all on function public.claim_ai_job() from public,anon,authenticated;
grant execute on function public.claim_ai_job() to service_role;

create function public.finish_ai_job(p_job_id uuid,p_lease_token uuid,p_result jsonb,p_model text,p_provider_response_id text,p_input_tokens integer,p_output_tokens integer,p_error_code text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job public.ai_jobs;
begin
 select * into job from public.ai_jobs where id=p_job_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
 if not found then return false; end if;
 if p_error_code is null then
  if not private.valid_ai_result(p_result,job.kind) or p_model is null or length(p_model) not between 1 and 200
   or p_provider_response_id is null or length(p_provider_response_id) not between 1 and 200
   or p_input_tokens<0 or p_output_tokens<0 then raise exception 'Invalid AI result' using errcode='23514'; end if;
 elsif p_error_code!~'^[A-Z][A-Z0-9_]{0,63}$' then raise exception 'Invalid AI error' using errcode='23514'; end if;
 update public.ai_jobs set status=case when p_error_code is null then 'COMPLETED' else 'FAILED' end,
  result=case when p_error_code is null then p_result end,
  model=case when p_error_code is null then p_model end,
  provider_response_id=case when p_error_code is null then p_provider_response_id end,
  input_tokens=case when p_error_code is null then p_input_tokens end,
  output_tokens=case when p_error_code is null then p_output_tokens end,
  error_code=p_error_code,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=job.id;
 return true;
end; $$;
revoke all on function public.finish_ai_job(uuid,uuid,jsonb,text,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.finish_ai_job(uuid,uuid,jsonb,text,text,integer,integer,text) to service_role;
