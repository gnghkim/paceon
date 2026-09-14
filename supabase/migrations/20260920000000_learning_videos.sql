-- LR2: video extensions retain the LR1 transaction lock, command ledger and wall clock timer.
create table public.learning_videos (
 workspace_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 video_id text not null check(video_id ~ '^[A-Za-z0-9_-]{11}$'),
 start_seconds numeric not null default 0 check(start_seconds between 0 and 604800),
 position_seconds numeric not null default 0 check(position_seconds between 0 and 604800),
 duration_seconds numeric check(duration_seconds between 0 and 604800),
 favorite boolean not null default false, archived boolean not null default false,
 transcript text not null default '' check(length(transcript)<=100000), transcript_version integer not null default 0 check(transcript_version>=0),
 context_start integer not null default 0, context_end integer not null default 0,
 updated_at timestamptz not null default clock_timestamp(), unique(user_id,video_id), unique(workspace_id,user_id),
 foreign key(workspace_id,user_id) references public.learning_workspaces(id,user_id) on delete cascade,
 check(context_start>=0 and context_end>=context_start and context_end<=length(transcript) and context_end-context_start<=12000)
);
create table public.learning_video_notes (
 id uuid primary key,workspace_id uuid not null,user_id uuid not null,position_seconds numeric not null check(position_seconds between 0 and 604800),
 content text not null check(length(btrim(content))>0 and length(content)<=4000),created_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,user_id) references public.learning_videos(workspace_id,user_id) on delete cascade
);
create index on public.learning_video_notes(workspace_id,created_at desc,id);
create table public.learning_video_visits (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,user_id uuid not null,session_id uuid not null,
 from_seconds numeric not null,to_seconds numeric not null,rate numeric not null check(rate between 0.25 and 4),created_at timestamptz not null default clock_timestamp(),
 check(from_seconds>=0 and to_seconds>from_seconds and to_seconds<=604800),
 foreign key(workspace_id,user_id) references public.learning_videos(workspace_id,user_id) on delete cascade,
 foreign key(session_id,workspace_id,user_id) references public.learning_sessions(id,workspace_id,user_id) on delete cascade
);
create index on public.learning_video_visits(workspace_id,created_at desc,id);
create table learning_private.video_observations (
 session_id uuid primary key references public.learning_sessions(id) on delete cascade,
 generation integer not null,position_seconds numeric not null,rate numeric not null,playing boolean not null,observed_at timestamptz not null
);
create table learning_private.video_text_activity (
 session_id uuid primary key references public.learning_sessions(id) on delete cascade,observed_at timestamptz not null
);
alter table public.learning_videos enable row level security;
alter table public.learning_video_notes enable row level security;
alter table public.learning_video_visits enable row level security;
create policy learning_videos_read on public.learning_videos for select to authenticated using(user_id=(select auth.uid()));
create policy learning_video_notes_read on public.learning_video_notes for select to authenticated using(user_id=(select auth.uid()));
create policy learning_video_visits_read on public.learning_video_visits for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.learning_videos,public.learning_video_notes,public.learning_video_visits from anon,authenticated;
grant select on public.learning_videos,public.learning_video_notes,public.learning_video_visits to authenticated;
grant all on public.learning_videos,public.learning_video_notes,public.learning_video_visits to service_role;

-- Source text stays outside messages: it can never become correction evidence.
create function learning_private.video_input(p_workspace uuid,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v public.learning_videos; notes jsonb; excerpt text; total bigint;
begin
 select * into v from public.learning_videos where workspace_id=p_workspace;
 if not found then return p_input; end if;
 excerpt:=substring(v.transcript from v.context_start+1 for v.context_end-v.context_start);
 select coalesce(jsonb_agg(jsonb_build_object('positionSeconds',position_seconds,'content',content) order by created_at,id),'[]'::jsonb)
 into notes from (select * from public.learning_video_notes where workspace_id=p_workspace order by created_at desc,id desc limit 20) n;
 select length(coalesce(p_input->>'prompt',''))+length(excerpt)
  +coalesce((select sum(length(x->>'content')) from jsonb_array_elements(p_input->'messages') x),0)
  +coalesce((select sum(length(x->>'content')) from jsonb_array_elements(notes) x),0) into total;
 if total>20000 then raise exception 'LEARNING_LIMIT'; end if;
 return p_input||jsonb_build_object('source',jsonb_build_object('type','YOUTUBE','videoId',v.video_id,'transcript',excerpt,'notes',notes));
end;
$$;

create function public.learning_video_command(p_command jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); a text; keys text[]; f text; rid uuid; wid uuid; sid uuid;
 t timestamptz; v public.learning_videos; w public.learning_workspaces; s public.learning_sessions; n public.learning_video_notes;
 old learning_private.video_observations; prior learning_private.commands; result jsonb; pos numeric; dur numeric; speed numeric; seconds numeric; playing boolean; recent_text boolean;
begin
 if u is null or jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>650000 then raise exception 'LEARNING_INVALID'; end if;
 a:=p_command->>'action';
 keys:=case a
 when 'VIDEO_ADD' then array['action','requestId','workspaceId','videoId','startSeconds','title']
 when 'VIDEO_EDIT' then array['action','requestId','workspaceId','title','favorite','archived']
 when 'VIDEO_SOURCE' then array['action','requestId','workspaceId','expectedVersion','transcript','contextStart','contextEnd']
 when 'VIDEO_NOTE' then array['action','requestId','workspaceId','noteId','positionSeconds','content']
 when 'VIDEO_TICK' then array['action','requestId','sessionId','deviceId','generation','positionSeconds','durationSeconds','playing','rate'] end;
 if keys is null or not(p_command ?& keys) or p_command-keys<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
 foreach f in array keys loop
  if f in ('favorite','archived','playing') then
   if jsonb_typeof(p_command->f) is distinct from 'boolean' then raise exception 'LEARNING_INVALID'; end if;
  elsif f in ('expectedVersion','contextStart','contextEnd','generation') then
   if jsonb_typeof(p_command->f) is distinct from 'number' or (p_command->>f)!~'^[0-9]{1,9}$' then raise exception 'LEARNING_INVALID'; end if;
  elsif f in ('startSeconds','positionSeconds','durationSeconds','rate') then
   if f='durationSeconds' and p_command->f='null'::jsonb then continue; end if;
   if jsonb_typeof(p_command->f) is distinct from 'number' or (p_command->>f)::numeric<0 or (p_command->>f)::numeric>604800 then raise exception 'LEARNING_INVALID'; end if;
  else
   if jsonb_typeof(p_command->f) is distinct from 'string' then raise exception 'LEARNING_INVALID'; end if;
   if f in ('requestId','workspaceId','sessionId','deviceId','noteId') and (p_command->>f)!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'LEARNING_INVALID'; end if;
  end if;
 end loop;
 if (p_command ? 'title' and (length(btrim(p_command->>'title'))<1 or length(p_command->>'title')>120))
 or (p_command ? 'videoId' and (p_command->>'videoId')!~'^[A-Za-z0-9_-]{11}$')
 or (p_command ? 'content' and (length(btrim(p_command->>'content'))<1 or length(p_command->>'content')>4000))
 or (p_command ? 'transcript' and length(p_command->>'transcript')>100000)
 or (p_command ? 'rate' and (p_command->>'rate')::numeric not between 0.25 and 4)
 or (p_command ? 'generation' and (p_command->>'generation')::integer<1) then raise exception 'LEARNING_INVALID'; end if;
 rid:=(p_command->>'requestId')::uuid; wid:=(p_command->>'workspaceId')::uuid; sid:=(p_command->>'sessionId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818)); t:=clock_timestamp();
 select * into prior from learning_private.commands where user_id=u and request_id=rid;
 if found then
  if prior.command<>p_command then raise exception 'LEARNING_CONFLICT'; end if;
  return prior.result;
 end if;
 if a='VIDEO_ADD' then
  select * into v from public.learning_videos where user_id=u and video_id=p_command->>'videoId';
  if found then
   select * into w from public.learning_workspaces where id=v.workspace_id;
   result:=jsonb_build_object('video',to_jsonb(v),'workspace',to_jsonb(w),'duplicate',true);
  else
   if exists(select 1 from public.learning_workspaces where id=wid) then raise exception 'LEARNING_CONFLICT'; end if;
   if (select count(*) from public.learning_workspaces where user_id=u)>=1000 then raise exception 'LEARNING_LIMIT'; end if;
   insert into public.learning_workspaces(id,user_id,title) values(wid,u,p_command->>'title') returning * into w;
   insert into public.learning_videos(workspace_id,user_id,video_id,start_seconds,position_seconds) values(wid,u,p_command->>'videoId',(p_command->>'startSeconds')::numeric,(p_command->>'startSeconds')::numeric) returning * into v;
   result:=jsonb_build_object('video',to_jsonb(v),'workspace',to_jsonb(w),'duplicate',false);
  end if;
 else
  if a='VIDEO_TICK' then
   select * into s from public.learning_sessions where id=sid and user_id=u;
   if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
   wid:=s.workspace_id;
   if s.device_id<>(p_command->>'deviceId')::uuid or s.generation<>(p_command->>'generation')::integer or s.status='ENDED' or s.last_seen_at<t-interval '30 minutes'
    or (s.status='ACTIVE' and s.lease_expires_at<=t) then raise exception 'LEARNING_CONFLICT'; end if;
  end if;
  select * into v from public.learning_videos where workspace_id=wid and user_id=u;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  if a='VIDEO_EDIT' then
   update public.learning_workspaces set title=p_command->>'title',updated_at=t where id=wid returning * into w;
   update public.learning_videos set favorite=(p_command->>'favorite')::boolean,archived=(p_command->>'archived')::boolean,updated_at=t where workspace_id=wid returning * into v;
   result:=jsonb_build_object('workspace',to_jsonb(w),'video',to_jsonb(v));
  elsif a='VIDEO_SOURCE' then
   if v.transcript_version<>(p_command->>'expectedVersion')::integer then raise exception 'LEARNING_CONFLICT'; end if;
   update public.learning_videos set transcript=p_command->>'transcript',transcript_version=transcript_version+1,context_start=(p_command->>'contextStart')::integer,context_end=(p_command->>'contextEnd')::integer,updated_at=t where workspace_id=wid returning * into v;
   result:=jsonb_build_object('video',to_jsonb(v));
  elsif a='VIDEO_NOTE' then
   insert into public.learning_video_notes(id,workspace_id,user_id,position_seconds,content) values((p_command->>'noteId')::uuid,wid,u,(p_command->>'positionSeconds')::numeric,p_command->>'content') returning * into n;
   result:=jsonb_build_object('note',to_jsonb(n));
  elsif a='VIDEO_TICK' then
   pos:=(p_command->>'positionSeconds')::numeric; dur:=(p_command->>'durationSeconds')::numeric; speed:=(p_command->>'rate')::numeric; playing:=(p_command->>'playing')::boolean;
   if dur is not null and pos>dur+1 then raise exception 'LEARNING_INVALID'; end if;
   select * into old from learning_private.video_observations where session_id=sid;
   seconds:=extract(epoch from t-old.observed_at);
   -- The old playing state covers the interval ending at this receipt (including a pause event).
   if s.status='ACTIVE' and old.generation=s.generation and old.playing and seconds>0 and seconds<=60
    and pos>old.position_seconds and pos-old.position_seconds<=seconds*old.rate+1
    and abs((pos-old.position_seconds)-seconds*old.rate)<=greatest(1,seconds*old.rate*0.25) then
    insert into public.learning_video_visits(workspace_id,user_id,session_id,from_seconds,to_seconds,rate) values(wid,u,sid,old.position_seconds,pos,old.rate);
   end if;
   perform learning_private.settle(u,t);
   select * into s from public.learning_sessions where id=sid;
   select exists(select 1 from learning_private.video_text_activity where session_id=sid and observed_at>t-interval '60 seconds') into recent_text;
   if playing and (s.status='ACTIVE' or (s.status='PAUSED' and s.pause_reason='IDLE')) then
    if exists(select 1 from public.learning_sessions where user_id=u and status='ACTIVE' and id<>sid) then raise exception 'LEARNING_CONFLICT'; end if;
    update public.learning_sessions set status='ACTIVE',pause_reason=null,last_seen_at=t,last_activity_at=t,lease_expires_at=t+interval '60 seconds',updated_at=t where id=sid returning * into s;
   elsif not playing and not recent_text and s.status='ACTIVE' then
    update public.learning_sessions set status='PAUSED',pause_reason='IDLE',last_seen_at=t,lease_expires_at=t,updated_at=t where id=sid returning * into s;
   end if;
   insert into learning_private.video_observations values(sid,s.generation,pos,speed,playing and s.status='ACTIVE',t)
   on conflict(session_id) do update set generation=excluded.generation,position_seconds=excluded.position_seconds,rate=excluded.rate,playing=excluded.playing,observed_at=excluded.observed_at;
   update public.learning_videos set position_seconds=pos,duration_seconds=coalesce(dur,duration_seconds),updated_at=t where workspace_id=wid returning * into v;
   result:=jsonb_build_object('video',to_jsonb(v),'session',to_jsonb(s));
  end if;
 end if;
 insert into learning_private.commands(user_id,request_id,command,result) values(u,rid,p_command,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'LEARNING_INVALID';
 when unique_violation then raise exception 'LEARNING_CONFLICT';
end;
$$;
revoke all on function public.learning_video_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_video_command(jsonb) to authenticated;
revoke all on all functions in schema learning_private from public,anon,authenticated;
create or replace function public.learning_command(p_command jsonb) returns jsonb
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
   if (a='MESSAGE' or (a='HEARTBEAT' and (p_command->>'activity')::boolean)) and s.status='ACTIVE' and exists(select 1 from public.learning_videos where workspace_id=wid) then
    insert into learning_private.video_text_activity values(sid,t) on conflict(session_id) do update set observed_at=excluded.observed_at;
   end if;
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
   inp:=learning_private.video_input(wid,jsonb_build_object('kind',k,'messages',msgs,'prompt',w.prompt));
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
   inp:=learning_private.video_input(wid,jsonb_build_object('kind',k,'messages',msgs,'prompt',w.prompt));
   if not exists(select 1 from jsonb_array_elements(msgs) v where v->>'role'='USER') and not (a='SUMMARY' and (length(coalesce(inp->'source'->>'transcript',''))>0 or jsonb_array_length(coalesce(inp->'source'->'notes','[]'::jsonb))>0)) then raise exception 'LEARNING_INVALID'; end if;
   if jsonb_array_length(msgs)>1000 or length(w.prompt)+(select coalesce(sum(length(v->>'content')),0) from jsonb_array_elements(msgs) v)>20000 then raise exception 'LEARNING_LIMIT'; end if;
   inp:=learning_private.video_input(wid,jsonb_build_object('kind',k,'messages',msgs,'prompt',w.prompt));
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
