-- LR1: RPC-only mutations; private ledgers are deliberately not exposed through PostgREST.
create schema if not exists learning_private;
revoke all on schema learning_private from public, anon, authenticated;

create table public.learning_workspaces (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 title text not null check(length(btrim(title)) between 1 and 120), prompt text not null default '' check(length(prompt)<=1000),
 draft text not null default '' check(length(draft)<=8000), draft_version integer not null default 0 check(draft_version>=0),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(), unique(id,user_id)
);
create table public.learning_sessions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null, status text not null check(status in ('ACTIVE','PAUSED','ENDED')),
 pause_reason text check(pause_reason in ('MANUAL','IDLE','HIDDEN','EXPIRED')), device_id uuid not null,
 generation integer not null default 1 check(generation>0), lease_expires_at timestamptz not null,
 last_seen_at timestamptz not null, last_activity_at timestamptz not null, elapsed_seconds integer not null default 0 check(elapsed_seconds>=0),
 timezone text not null, started_at timestamptz not null default clock_timestamp(), ended_at timestamptz,
 updated_at timestamptz not null default clock_timestamp(), unique(id,workspace_id,user_id),
 foreign key(workspace_id,user_id) references public.learning_workspaces(id,user_id) on delete cascade,
 check((status='ENDED')=(ended_at is not null)), check((status='PAUSED')=(pause_reason is not null))
);
create unique index learning_one_active on public.learning_sessions(user_id) where status='ACTIVE';
create index learning_sessions_workspace on public.learning_sessions(workspace_id,started_at desc);
create table public.learning_ai_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null, session_id uuid, kind text not null check(kind in ('WRITING_REPLY','STUDY_SUMMARY')),
 status text not null default 'QUEUED' check(status in ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
 input jsonb not null, output jsonb, error_code text, attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_expires_at timestamptz, model text, provider_response_id text, input_tokens integer, output_tokens integer,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(id,workspace_id,user_id),
 foreign key(workspace_id,user_id) references public.learning_workspaces(id,user_id) on delete cascade,
 foreign key(session_id,workspace_id,user_id) references public.learning_sessions(id,workspace_id,user_id) on delete cascade
);
create unique index learning_one_reply on public.learning_ai_jobs(workspace_id) where kind='WRITING_REPLY' and status in ('QUEUED','RUNNING');
create index learning_jobs_queue on public.learning_ai_jobs(status,created_at);
create index learning_jobs_owner on public.learning_ai_jobs(user_id,created_at);
create table public.learning_messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null, session_id uuid, role text not null check(role in ('USER','ASSISTANT')),
 content text not null check(length(content) between 1 and 20000), created_at timestamptz not null default clock_timestamp(), job_id uuid,
 foreign key(workspace_id,user_id) references public.learning_workspaces(id,user_id) on delete cascade,
 foreign key(session_id,workspace_id,user_id) references public.learning_sessions(id,workspace_id,user_id) on delete cascade,
 foreign key(job_id,workspace_id,user_id) references public.learning_ai_jobs(id,workspace_id,user_id) on delete cascade,
 unique(job_id,role)
);
create index learning_messages_workspace on public.learning_messages(workspace_id,created_at);
-- UTC segments retain timezone-at-start for future local-day statistics without reconstructing elapsed totals.
create table learning_private.activity_segments (
 session_id uuid not null references public.learning_sessions(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 started_at timestamptz not null, ended_at timestamptz not null, timezone text not null,
 check(ended_at>started_at), primary key(session_id,started_at)
);
create table learning_private.commands (
 user_id uuid not null references auth.users(id) on delete cascade, request_id uuid not null,
 command jsonb not null, result jsonb not null, created_at timestamptz not null default clock_timestamp(), primary key(user_id,request_id)
);
create table learning_private.job_requests (
 user_id uuid not null references auth.users(id) on delete cascade, kind text not null, created_at timestamptz not null default clock_timestamp()
);
create index on learning_private.job_requests(user_id,created_at);
alter table public.learning_workspaces enable row level security;
alter table public.learning_sessions enable row level security;
alter table public.learning_messages enable row level security;
alter table public.learning_ai_jobs enable row level security;
create policy learning_workspaces_read on public.learning_workspaces for select to authenticated using(user_id=(select auth.uid()));
create policy learning_sessions_read on public.learning_sessions for select to authenticated using(user_id=(select auth.uid()));
create policy learning_messages_read on public.learning_messages for select to authenticated using(user_id=(select auth.uid()));
create policy learning_jobs_read on public.learning_ai_jobs for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.learning_workspaces,public.learning_sessions,public.learning_messages,public.learning_ai_jobs from anon,authenticated;
grant select on public.learning_workspaces,public.learning_sessions,public.learning_messages to authenticated;
grant select(id,user_id,workspace_id,session_id,kind,status,output,error_code,created_at,updated_at) on public.learning_ai_jobs to authenticated;
grant all on public.learning_workspaces,public.learning_sessions,public.learning_messages,public.learning_ai_jobs to service_role;

create function learning_private.public_job(j public.learning_ai_jobs) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(j)-array['input','attempts','lease_token','lease_expires_at','model','provider_response_id','input_tokens','output_tokens'];
$$;
-- Accrue only the interval that was already covered by both an activity observation and a live lease.
create function learning_private.settle(p_user uuid,p_now timestamptz) returns void language plpgsql set search_path='' as $$
begin
 insert into learning_private.activity_segments(session_id,user_id,started_at,ended_at,timezone)
 select id,user_id,last_seen_at,least(p_now,lease_expires_at,last_activity_at+interval '60 seconds'),timezone
 from public.learning_sessions where user_id=p_user and status='ACTIVE' and last_seen_at<least(p_now,lease_expires_at,last_activity_at+interval '60 seconds');
 update public.learning_sessions set
 elapsed_seconds=elapsed_seconds+case when status='ACTIVE' then greatest(0,floor(extract(epoch from least(p_now,lease_expires_at,last_activity_at+interval '60 seconds')-last_seen_at)))::integer else 0 end,
 status=case when last_seen_at<=p_now-interval '30 minutes' then 'ENDED' when status='ACTIVE' and (lease_expires_at<=p_now or last_activity_at<=p_now-interval '60 seconds') then 'PAUSED' else status end,
 pause_reason=case when last_seen_at<=p_now-interval '30 minutes' then null when status='ACTIVE' and (lease_expires_at<=p_now or last_activity_at<=p_now-interval '60 seconds') then 'EXPIRED' else pause_reason end,
 ended_at=case when last_seen_at<=p_now-interval '30 minutes' then greatest(last_seen_at,least(lease_expires_at,last_activity_at+interval '60 seconds')) else ended_at end,
 last_seen_at=case when status='ACTIVE' then least(p_now,lease_expires_at,last_activity_at+interval '60 seconds') else last_seen_at end,
 updated_at=p_now where user_id=p_user and status<>'ENDED';
end;
$$;

create function public.learning_command(p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 u uuid:=auth.uid(); a text; rid uuid; wid uuid; sid uuid; did uuid; jid uuid; k text; keys text[];
 t timestamptz:=clock_timestamp(); w public.learning_workspaces; s public.learning_sessions; j public.learning_ai_jobs; m public.learning_messages;
 prior learning_private.commands; result jsonb; msgs jsonb; inp jsonb; field text;
begin
 if u is null then raise exception 'LEARNING_INVALID'; end if;
 if jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>50000 then raise exception 'LEARNING_INVALID'; end if;
 a:=p_command->>'action';
 keys:=case a
 when 'CREATE' then array['action','requestId','workspaceId','title','prompt']
 when 'SAVE_DRAFT' then array['action','requestId','workspaceId','expectedVersion','draft']
 when 'START' then array['action','requestId','workspaceId','deviceId','timezone']
 when 'TAKEOVER' then array['action','requestId','workspaceId','deviceId','timezone']
 when 'HEARTBEAT' then array['action','requestId','sessionId','deviceId','generation','activity']
 when 'PAUSE' then array['action','requestId','sessionId','deviceId','generation','activity','reason']
 when 'END' then array['action','requestId','sessionId','deviceId','generation','activity']
 when 'MESSAGE' then array['action','requestId','workspaceId','sessionId','content','deviceId','generation']
 when 'SUMMARY' then array['action','requestId','workspaceId','sessionId']
 when 'RETRY' then array['action','requestId','jobId'] end;
 if keys is null or not(p_command ?& keys) or (p_command-keys)<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
 foreach field in array keys loop
  if field in ('expectedVersion','generation') then
   if jsonb_typeof(p_command->field) is distinct from 'number' or (p_command->>field)!~'^[0-9]{1,9}$' then raise exception 'LEARNING_INVALID'; end if;
  elsif field='activity' then
   if jsonb_typeof(p_command->field) is distinct from 'boolean' then raise exception 'LEARNING_INVALID'; end if;
  else
   if jsonb_typeof(p_command->field) is distinct from 'string' then raise exception 'LEARNING_INVALID'; end if;
   if field in ('requestId','workspaceId','sessionId','deviceId','jobId') and (p_command->>field)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'LEARNING_INVALID'; end if;
  end if;
 end loop;
 rid:=(p_command->>'requestId')::uuid; wid:=(p_command->>'workspaceId')::uuid; sid:=(p_command->>'sessionId')::uuid; did:=(p_command->>'deviceId')::uuid; jid:=(p_command->>'jobId')::uuid;
 if (p_command ? 'title' and (length(btrim(p_command->>'title')) not between 1 and 120 or length(p_command->>'title')>120))
 or (p_command ? 'prompt' and length(p_command->>'prompt')>1000)
 or (p_command ? 'draft' and length(p_command->>'draft')>8000)
 or (p_command ? 'content' and (length(btrim(p_command->>'content'))=0 or length(p_command->>'content')>8000))
 or (p_command ? 'generation' and (p_command->>'generation')::integer<1)
 or (p_command ? 'reason' and p_command->>'reason' not in ('MANUAL','IDLE','HIDDEN'))
 or (p_command ? 'timezone' and not exists(select 1 from pg_catalog.pg_timezone_names where name=p_command->>'timezone')) then raise exception 'LEARNING_INVALID'; end if;
 -- Transaction-wide per-user serialization covers leases, CAS, idempotency and rate limits.
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818));
 t:=clock_timestamp();
 select * into prior from learning_private.commands where user_id=u and request_id=rid;
 if found then
  if prior.command<>p_command then raise exception 'LEARNING_CONFLICT'; end if;
  return prior.result;
 end if;
 if a='CREATE' then
  if exists(select 1 from public.learning_workspaces where id=wid) then raise exception 'LEARNING_CONFLICT'; end if;
  if (select count(*) from public.learning_workspaces where user_id=u)>=1000 then raise exception 'LEARNING_LIMIT'; end if;
  insert into public.learning_workspaces(id,user_id,title,prompt) values(wid,u,p_command->>'title',p_command->>'prompt') returning * into w;
  result:=jsonb_build_object('workspace',to_jsonb(w));
 elsif a='RETRY' then
  select * into j from public.learning_ai_jobs where id=jid and user_id=u for update;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  if j.status<>'FAILED' or j.attempts>=3 then raise exception 'LEARNING_CONFLICT'; end if;
  wid:=j.workspace_id; k:=j.kind;
 else
  if sid is not null then
   select * into s from public.learning_sessions where id=sid and user_id=u;
   if not found or (wid is not null and wid<>s.workspace_id) then raise exception 'LEARNING_NOT_FOUND'; end if;
   wid:=s.workspace_id;
  end if;
  select * into w from public.learning_workspaces where id=wid and user_id=u;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  if a='SAVE_DRAFT' then
   if w.draft_version<>(p_command->>'expectedVersion')::integer then raise exception 'LEARNING_CONFLICT'; end if;
   update public.learning_workspaces set draft=p_command->>'draft',draft_version=draft_version+1,updated_at=t where id=wid returning * into w;
   result:=jsonb_build_object('workspace',to_jsonb(w));
  elsif a in ('START','TAKEOVER') then
   perform learning_private.settle(u,t);
   if exists(select 1 from public.learning_sessions where user_id=u and status='ACTIVE' and (workspace_id<>wid or device_id<>did)) then
    if a='START' then raise exception 'LEARNING_CONFLICT'; end if;
    update public.learning_sessions set status='PAUSED',pause_reason='EXPIRED',generation=generation+1,lease_expires_at=t,updated_at=t where user_id=u and status='ACTIVE';
   end if;
   select * into s from public.learning_sessions where user_id=u and workspace_id=wid and status<>'ENDED' order by started_at desc limit 1;
   if found then
    if s.device_id<>did and a='START' and s.lease_expires_at>t then raise exception 'LEARNING_CONFLICT'; end if;
    update public.learning_sessions set status='ACTIVE',pause_reason=null,device_id=did,generation=generation+1,lease_expires_at=t+interval '60 seconds',last_seen_at=t,last_activity_at=t,updated_at=t where id=s.id returning * into s;
   else
    insert into public.learning_sessions(user_id,workspace_id,status,device_id,lease_expires_at,last_seen_at,last_activity_at,timezone)
    values(u,wid,'ACTIVE',did,t+interval '60 seconds',t,t,p_command->>'timezone') returning * into s;
   end if;
   result:=jsonb_build_object('session',to_jsonb(s));
  elsif a in ('HEARTBEAT','PAUSE','END','MESSAGE') then
   if s.device_id<>did or s.generation<>(p_command->>'generation')::integer then raise exception 'LEARNING_CONFLICT'; end if;
   perform learning_private.settle(u,t);
   select * into s from public.learning_sessions where id=sid;
   if a='MESSAGE' then
    if s.status='ENDED' then raise exception 'LEARNING_CONFLICT'; end if;
    k:='WRITING_REPLY';
   else
    if s.status='ENDED' then
     if a<>'END' then raise exception 'LEARNING_CONFLICT'; end if;
    elsif a='END' then
     update public.learning_sessions set status='ENDED',pause_reason=null,ended_at=t,lease_expires_at=t,last_seen_at=t,updated_at=t where id=sid returning * into s;
    elsif a='PAUSE' then
     update public.learning_sessions set status='PAUSED',pause_reason=p_command->>'reason',lease_expires_at=t,last_seen_at=t,updated_at=t where id=sid returning * into s;
    elsif s.status='ACTIVE' then
     update public.learning_sessions set last_seen_at=t,last_activity_at=case when (p_command->>'activity')::boolean then t else last_activity_at end,lease_expires_at=t+interval '60 seconds',updated_at=t where id=sid returning * into s;
    end if;
    result:=jsonb_build_object('session',to_jsonb(s));
   end if;
  elsif a='SUMMARY' then k:='STUDY_SUMMARY';
  end if;
 end if;
 if k is not null then
  -- Reuse identical completed summaries before quota admission; original message IDs identify the source revision.
  if a='SUMMARY' then
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'content',content) order by created_at,id),'[]'::jsonb) into msgs from public.learning_messages where workspace_id=wid and session_id=sid;
   inp:=jsonb_build_object('kind',k,'messages',msgs,'prompt',w.prompt);
   select * into j from public.learning_ai_jobs where user_id=u and session_id=sid and kind=k and input=inp and status='SUCCEEDED' order by created_at desc limit 1;
   if found then
    result:=jsonb_build_object('job',learning_private.public_job(j));
    insert into learning_private.commands(user_id,request_id,command,result) values(u,rid,p_command,result);
    return result;
   end if;
  end if;
  if (select count(*) from public.learning_ai_jobs where user_id=u and status in ('QUEUED','RUNNING'))>=3
   or (select count(*) from learning_private.job_requests where user_id=u and created_at>t-interval '1 minute')>=10
   or (select count(*) from learning_private.job_requests where user_id=u and kind=k and created_at>=date_trunc('day',t at time zone 'UTC') at time zone 'UTC')>=(case when k='STUDY_SUMMARY' then 20 else 100 end) then raise exception 'LEARNING_LIMIT'; end if;
  if exists(select 1 from public.learning_ai_jobs where workspace_id=wid and kind=k and status in ('QUEUED','RUNNING')) then raise exception 'LEARNING_CONFLICT'; end if;
  if a='RETRY' then
   update public.learning_ai_jobs set status='QUEUED',error_code=null,lease_token=null,lease_expires_at=null,updated_at=t where id=jid returning * into j;
  else
   jid:=gen_random_uuid();
   if a='MESSAGE' then
    -- Snapshot includes the new text atomically; admission failures leave the caller's draft untouched.
    m.id:=gen_random_uuid(); m.role:='USER'; m.content:=p_command->>'content';
   end if;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role,'content',content) order by created_at,id),'[]'::jsonb) into msgs
    from public.learning_messages where workspace_id=wid and (k='WRITING_REPLY' or session_id=sid);
   if a='MESSAGE' then msgs:=msgs||jsonb_build_array(jsonb_build_object('id',m.id,'role','USER','content',m.content)); end if;
   if jsonb_array_length(msgs)=0 or not exists(select 1 from jsonb_array_elements(msgs) v where v->>'role'='USER') then raise exception 'LEARNING_INVALID'; end if;
   if jsonb_array_length(msgs)>1000 or length(w.prompt)+(select coalesce(sum(length(v->>'content')),0) from jsonb_array_elements(msgs) v)>20000 then raise exception 'LEARNING_LIMIT'; end if;
   inp:=jsonb_build_object('kind',k,'messages',msgs,'prompt',w.prompt);
   insert into public.learning_ai_jobs(id,user_id,workspace_id,session_id,kind,input) values(jid,u,wid,sid,k,inp) returning * into j;
   if a='MESSAGE' then
    insert into public.learning_messages(id,user_id,workspace_id,session_id,role,content,job_id) values(m.id,u,wid,sid,'USER',m.content,jid) returning * into m;
   end if;
  end if;
  insert into learning_private.job_requests(user_id,kind) values(u,k);
  result:=jsonb_build_object('job',learning_private.public_job(j));
  if a='MESSAGE' then result:=result||jsonb_build_object('message',to_jsonb(m)); end if;
 end if;
 insert into learning_private.commands(user_id,request_id,command,result) values(u,rid,p_command,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'LEARNING_INVALID';
 when unique_violation then raise exception 'LEARNING_CONFLICT';
end;
$$;
revoke all on function public.learning_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_command(jsonb) to authenticated;

create function public.claim_learning_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_ai_jobs; t timestamptz:=clock_timestamp();
begin
 update public.learning_ai_jobs set status='FAILED',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null,updated_at=t where status='RUNNING' and lease_expires_at<=t and attempts>=3;
 select * into j from public.learning_ai_jobs where attempts<3 and (status='QUEUED' or (status='RUNNING' and lease_expires_at<=t)) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.learning_ai_jobs set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=t+interval '3 minutes',updated_at=t where id=j.id returning * into j;
 return to_jsonb(j);
end;
$$;
create function public.finish_learning_job(p_job_id uuid,p_lease_token uuid,p_output jsonb,p_error_code text,p_model text,p_provider_response_id text,p_input_tokens integer,p_output_tokens integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_ai_jobs; v jsonb; f text; t timestamptz:=clock_timestamp();
begin
 select * into j from public.learning_ai_jobs where id=p_job_id for update;
 t:=clock_timestamp();
 if not found or j.status<>'RUNNING' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=t then return false; end if;
 if p_error_code is not null then
  if p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then raise exception 'LEARNING_INVALID'; end if;
  update public.learning_ai_jobs set status='FAILED',error_code=p_error_code,lease_token=null,lease_expires_at=null,updated_at=t where id=j.id;
  return true;
 end if;
 if jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['summary','corrections','expressions','nextPrompt']) or p_output-array['summary','corrections','expressions','nextPrompt']<>'{}'::jsonb
  or jsonb_typeof(p_output->'summary') is distinct from 'string' or length(btrim(p_output->>'summary')) not between 1 and 2000
  or jsonb_typeof(p_output->'nextPrompt') is distinct from 'string' or length(p_output->>'nextPrompt')>1000
  or jsonb_typeof(p_output->'corrections') is distinct from 'array' or jsonb_typeof(p_output->'expressions') is distinct from 'array'
  or octet_length(p_output::text)>131072 or p_model is null or length(p_model) not between 1 and 200
  or p_input_tokens<0 or p_output_tokens<0
  or length(p_provider_response_id)>300 then raise exception 'LEARNING_INVALID'; end if;
 if jsonb_array_length(p_output->'corrections')>3 or jsonb_array_length(p_output->'expressions')>10 then raise exception 'LEARNING_INVALID'; end if;
 for v in select value from jsonb_array_elements(p_output->'corrections') loop
  if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['original','revised','reason']) or v-array['original','revised','reason']<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
  if not exists(select 1 from jsonb_array_elements(j.input->'messages') x where x->>'role'='USER' and strpos(x->>'content',v->>'original')>0) then raise exception 'LEARNING_INVALID'; end if;
  foreach f in array array['original','revised','reason'] loop
   if jsonb_typeof(v->f) is distinct from 'string' or length(btrim(v->>f))<1 or length(v->>f)>(case when f='reason' then 600 else 2000 end) then raise exception 'LEARNING_INVALID'; end if;
  end loop;
 end loop;
 for v in select value from jsonb_array_elements(p_output->'expressions') loop
  if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['phrase','meaning','example']) or v-array['phrase','meaning','example']<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
  foreach f in array array['phrase','meaning','example'] loop
   if jsonb_typeof(v->f) is distinct from 'string' or length(btrim(v->>f))<1 or length(v->>f)>(case when f='phrase' then 200 when f='meaning' then 600 else 1000 end) then raise exception 'LEARNING_INVALID'; end if;
  end loop;
 end loop;
 update public.learning_ai_jobs set status='SUCCEEDED',output=p_output,error_code=null,model=p_model,provider_response_id=p_provider_response_id,input_tokens=p_input_tokens,output_tokens=p_output_tokens,lease_token=null,lease_expires_at=null,updated_at=t where id=j.id;
 if j.kind='WRITING_REPLY' then
  insert into public.learning_messages(user_id,workspace_id,session_id,role,content,job_id) values(j.user_id,j.workspace_id,j.session_id,'ASSISTANT',p_output->>'summary',j.id);
 end if;
 return true;
end;
$$;
revoke all on function public.claim_learning_job(),public.finish_learning_job(uuid,uuid,jsonb,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.claim_learning_job(),public.finish_learning_job(uuid,uuid,jsonb,text,text,text,integer,integer) to service_role;
revoke all on all functions in schema learning_private from public,anon,authenticated;
