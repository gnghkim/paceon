-- Speech mutations are RPC-only. Paths, upload bindings and worker leases stay private.
create table public.learning_speech (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid not null, session_id uuid, kind text not null check(kind in ('PROMPT','RECORDING')),
 status text not null check(status in ('UPLOADING','QUEUED','RUNNING','READY','FAILED','DELETED')),
 reference_text text not null default '' check(length(reference_text)<=8000),
 original_text text not null default '' check(length(original_text)<=8000),
 edited_text text check(length(edited_text)<=8000), feedback jsonb, input jsonb not null default '{}',
 storage_path text, mime_type text, file_size bigint check(file_size between 1 and 10485760),
 content_sha256 text check(content_sha256 ~ '^[a-f0-9]{64}$'), duration_seconds numeric check(duration_seconds>0 and duration_seconds<=60),
 keep_audio boolean not null default false, expires_at timestamptz not null default clock_timestamp()+interval '30 days',
 error_code text, attempts integer not null default 0 check(attempts between 0 and 3), lease_token uuid, lease_expires_at timestamptz,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 foreign key(workspace_id,user_id) references public.learning_workspaces(id,user_id) on delete cascade,
 foreign key(session_id,workspace_id,user_id) references public.learning_sessions(id,workspace_id,user_id) on delete cascade
);
create index learning_speech_owner on public.learning_speech(user_id,workspace_id,created_at desc);
create index learning_speech_queue on public.learning_speech(status,created_at);
-- No FK: retain deterministic cleanup targets after workspace/account cascades and late storage writes.
create table learning_private.speech_audio (id uuid primary key, storage_path text not null unique, deleting_at timestamptz, cleaned_at timestamptz);
alter table public.learning_speech enable row level security;
create policy learning_speech_read on public.learning_speech for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.learning_speech from anon,authenticated;
grant select(id,user_id,workspace_id,session_id,kind,status,reference_text,original_text,edited_text,feedback,mime_type,file_size,duration_seconds,keep_audio,expires_at,error_code,attempts,created_at,updated_at) on public.learning_speech to authenticated;
grant all on public.learning_speech to service_role;
create function learning_private.public_speech(j public.learning_speech) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(j)-array['input','storage_path','content_sha256','lease_token','lease_expires_at'];
$$;
create function learning_private.speech_admit(u uuid,k text) returns void language plpgsql set search_path='' as $$
begin
 if (select count(*) from public.learning_speech where user_id=u and status in ('UPLOADING','QUEUED','RUNNING'))>=3
 or (select count(*) from learning_private.job_requests where user_id=u and kind='SPEECH_'||k and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC') >= (case when k='PROMPT' then 50 else 100 end) then raise exception 'LEARNING_LIMIT'; end if;
 insert into learning_private.job_requests(user_id,kind) values(u,'SPEECH_'||k);
end;
$$;
create function public.begin_speech_upload(p_id uuid,p_workspace_id uuid,p_session_id uuid,p_reference_text text,p_mime_type text,p_file_size bigint,p_content_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.learning_speech;
begin
 if u is null or p_id is null or p_reference_text is null or length(p_reference_text)>8000 or p_mime_type is null
 or p_mime_type not in ('audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg') or p_file_size is null or p_file_size not between 1 and 10485760
 or p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'LEARNING_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818));
 if not exists(select 1 from public.learning_workspaces where id=p_workspace_id and user_id=u)
 or (p_session_id is not null and not exists(select 1 from public.learning_sessions where id=p_session_id and workspace_id=p_workspace_id and user_id=u)) then raise exception 'LEARNING_NOT_FOUND'; end if;
 select * into j from public.learning_speech where id=p_id for update;
 if found then
  if j.user_id<>u then raise exception 'LEARNING_NOT_FOUND'; end if;
  if j.kind<>'RECORDING' or j.status='DELETED' or j.workspace_id<>p_workspace_id or j.session_id is distinct from p_session_id or j.reference_text<>p_reference_text or j.mime_type<>p_mime_type or j.file_size<>p_file_size or j.content_sha256<>p_content_sha256 then raise exception 'LEARNING_CONFLICT'; end if;
  return learning_private.public_speech(j);
 end if;
 perform learning_private.speech_admit(u,'RECORDING');
 insert into public.learning_speech(id,user_id,workspace_id,session_id,kind,status,reference_text,mime_type,file_size,content_sha256,storage_path)
 values(p_id,u,p_workspace_id,p_session_id,'RECORDING','UPLOADING',p_reference_text,p_mime_type,p_file_size,p_content_sha256,u::text||'/'||p_id::text||'/recording') returning * into j;
 insert into learning_private.speech_audio(id,storage_path) values(j.id,j.storage_path);
 return learning_private.public_speech(j);
end;
$$;
create function public.queue_speech_recording(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); j public.learning_speech;
begin
 if u is null then raise exception 'LEARNING_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818));
 select * into j from public.learning_speech where id=p_id and user_id=u for update;
 if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
 if j.kind<>'RECORDING' or j.status='DELETED' then raise exception 'LEARNING_CONFLICT'; end if;
 if j.status<>'UPLOADING' then return learning_private.public_speech(j); end if;
 if exists(select 1 from learning_private.speech_audio where id=j.id and deleting_at is not null) then raise exception 'LEARNING_CONFLICT'; end if;
 if not exists(select 1 from storage.objects where bucket_id='learning-audio' and name=j.storage_path and metadata->>'size'=j.file_size::text and metadata->>'mimetype'=j.mime_type) then raise exception 'LEARNING_INVALID'; end if;
 update public.learning_speech set status='QUEUED',updated_at=clock_timestamp() where id=j.id returning * into j;
 return learning_private.public_speech(j);
end;
$$;
create function public.learning_speech_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); a text; keys text[]; f text; rid uuid; jid uuid; j public.learning_speech; prior learning_private.commands; result jsonb;
begin
 if u is null or jsonb_typeof(p_command) is distinct from 'object' or octet_length(p_command::text)>50000 then raise exception 'LEARNING_INVALID'; end if;
 a:=p_command->>'action';
 keys:=case a when 'PROMPT' then array['action','requestId','id','workspaceId','level','topic'] when 'EDIT' then array['action','requestId','id','text'] when 'DELETE' then array['action','requestId','id'] when 'KEEP' then array['action','requestId','id','keep'] when 'RETRY' then array['action','requestId','id'] end;
 if keys is null or not(p_command ?& keys) or p_command-keys<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
 foreach f in array keys loop
  if jsonb_typeof(p_command->f) is distinct from (case when f='keep' then 'boolean' else 'string' end) then raise exception 'LEARNING_INVALID'; end if;
 end loop;
 rid:=(p_command->>'requestId')::uuid; jid:=(p_command->>'id')::uuid;
 if (a='PROMPT' and (p_command->>'level' not in ('EASY','MEDIUM') or length(p_command->>'topic')>200)) or (a='EDIT' and length(p_command->>'text')>8000) then raise exception 'LEARNING_INVALID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818));
 select * into prior from learning_private.commands where user_id=u and request_id=rid;
 if found then
  if prior.command<>p_command then raise exception 'LEARNING_CONFLICT'; end if;
  -- Read current state: replay may never resurrect a deleted item's private content.
  select * into j from public.learning_speech where id=jid and user_id=u;
  return jsonb_build_object('item',learning_private.public_speech(j));
 end if;
 if a='PROMPT' then
  if not exists(select 1 from public.learning_workspaces where id=(p_command->>'workspaceId')::uuid and user_id=u) then raise exception 'LEARNING_NOT_FOUND'; end if;
  if exists(select 1 from learning_private.speech_audio where id=jid) then raise exception 'LEARNING_CONFLICT'; end if;
  perform learning_private.speech_admit(u,'PROMPT');
  insert into public.learning_speech(id,user_id,workspace_id,kind,status,input,storage_path)
  values(jid,u,(p_command->>'workspaceId')::uuid,'PROMPT','QUEUED',jsonb_build_object('level',p_command->>'level','topic',p_command->>'topic'),u::text||'/'||jid::text||'/sample.mp3') returning * into j;
  insert into learning_private.speech_audio(id,storage_path) values(j.id,j.storage_path);
 else
  select * into j from public.learning_speech where id=jid and user_id=u for update;
  if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
  if j.status='DELETED' and a<>'DELETE' then raise exception 'LEARNING_CONFLICT'; end if;
  if a='DELETE' then
   update public.learning_speech set status='DELETED',reference_text='',original_text='',edited_text=null,feedback=null,input='{}',lease_token=null,lease_expires_at=null,keep_audio=false,updated_at=clock_timestamp() where id=jid returning * into j;
  elsif a='EDIT' then
   if j.status<>'READY' or j.kind<>'RECORDING' then raise exception 'LEARNING_CONFLICT'; end if;
   update public.learning_speech set edited_text=p_command->>'text',updated_at=clock_timestamp() where id=jid returning * into j;
  elsif a='KEEP' then
   if j.storage_path is null or exists(select 1 from learning_private.speech_audio where id=jid and deleting_at is not null) then raise exception 'LEARNING_CONFLICT'; end if;
   update public.learning_speech set keep_audio=(p_command->>'keep')::boolean,updated_at=clock_timestamp() where id=jid returning * into j;
  elsif a='RETRY' then
   if j.status<>'FAILED' or j.attempts>=3 or j.storage_path is null or exists(select 1 from learning_private.speech_audio where id=jid and deleting_at is not null) then raise exception 'LEARNING_CONFLICT'; end if;
   perform learning_private.speech_admit(u,j.kind);
   update public.learning_speech set status='QUEUED',error_code=null,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=jid returning * into j;
  end if;
 end if;
 result:=jsonb_build_object('item',learning_private.public_speech(j));
 insert into learning_private.commands(user_id,request_id,command,result) values(u,rid,p_command,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation then raise exception 'LEARNING_INVALID';
 when unique_violation then raise exception 'LEARNING_CONFLICT';
end;
$$;
create function public.speech_audio_path(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 select * into j from public.learning_speech where id=p_id and user_id=auth.uid() and status<>'DELETED';
 if not found or j.storage_path is null or exists(select 1 from learning_private.speech_audio where id=p_id and deleting_at is not null) then raise exception 'LEARNING_NOT_FOUND'; end if;
 return jsonb_build_object('storage_path',j.storage_path,'mime_type',j.mime_type);
end;
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('learning-audio','learning-audio',false,10485760,array['audio/webm','audio/mp4','audio/mpeg','audio/wav','audio/ogg']);
create function public.speech_storage_allowed(p_name text,p_metadata jsonb,p_write boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 -- A row lock serializes admission with DELETE/cleanup; uploads never overwrite objects.
 select * into j from public.learning_speech where storage_path=p_name and user_id=auth.uid() for share;
 if not found or j.status='DELETED' or exists(select 1 from learning_private.speech_audio where id=j.id and deleting_at is not null) then return false; end if;
 if not p_write then return true; end if;
 return j.kind='RECORDING' and j.status='UPLOADING' and p_metadata->>'size'=j.file_size::text and p_metadata->>'mimetype'=j.mime_type;
end;
$$;
create policy learning_audio_read on storage.objects for select to authenticated using(bucket_id='learning-audio' and public.speech_storage_allowed(name,metadata,false));
create policy learning_audio_insert on storage.objects for insert to authenticated with check(bucket_id='learning-audio' and public.speech_storage_allowed(name,metadata,true));
create function public.claim_speech_job() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_speech; t timestamptz:=clock_timestamp();
begin
 update public.learning_speech set status='FAILED',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null,updated_at=t where status='RUNNING' and lease_expires_at<=t and attempts>=3;
 select * into j from public.learning_speech where attempts<3 and (status='QUEUED' or (status='RUNNING' and lease_expires_at<=t)) order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.learning_speech set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=t+interval '3 minutes',updated_at=t where id=j.id returning * into j;
 return to_jsonb(j);
end;
$$;
create function public.finish_speech_job(p_job_id uuid,p_lease_token uuid,p_output jsonb,p_error_code text) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_speech; fb jsonb; v jsonb; f text; t timestamptz;
begin
 select * into j from public.learning_speech where id=p_job_id for update; t:=clock_timestamp();
 if not found or j.status<>'RUNNING' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=t then return false; end if;
 if p_error_code is not null then
  if p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then raise exception 'LEARNING_INVALID'; end if;
  update public.learning_speech set status='FAILED',error_code=p_error_code,lease_token=null,lease_expires_at=null,updated_at=t where id=j.id; return true;
 end if;
 if jsonb_typeof(p_output) is distinct from 'object' or not(p_output ?& array['referenceText','originalText','feedback','storagePath','mimeType','durationSeconds']) or p_output-array['referenceText','originalText','feedback','storagePath','mimeType','durationSeconds']<>'{}'::jsonb or octet_length(p_output::text)>131072 then raise exception 'LEARNING_INVALID'; end if;
 foreach f in array array['referenceText','originalText','storagePath','mimeType'] loop
  if jsonb_typeof(p_output->f) is distinct from 'string' then raise exception 'LEARNING_INVALID'; end if;
 end loop;
 if length(p_output->>'referenceText')>8000 or length(p_output->>'originalText')>8000 or p_output->>'storagePath' is distinct from j.storage_path
 or (j.kind='PROMPT' and (length(btrim(p_output->>'referenceText'))=0 or p_output->>'mimeType'<>'audio/mpeg'))
 or (j.kind='RECORDING' and (length(btrim(p_output->>'originalText'))=0 or p_output->>'referenceText'<>j.reference_text or p_output->>'mimeType'<>j.mime_type))
 or jsonb_typeof(p_output->'durationSeconds') is distinct from 'number' or (p_output->>'durationSeconds')::numeric not between 0.001 and 60 then raise exception 'LEARNING_INVALID'; end if;
 fb:=p_output->'feedback';
 if jsonb_typeof(fb) is distinct from 'object' or not(fb ?& array['summary','corrections','expressions','nextPrompt']) or fb-array['summary','corrections','expressions','nextPrompt']<>'{}'::jsonb
 or jsonb_typeof(fb->'summary') is distinct from 'string' or length(btrim(fb->>'summary')) not between 1 and 2000
 or jsonb_typeof(fb->'nextPrompt') is distinct from 'string' or length(fb->>'nextPrompt')>1000
 or jsonb_typeof(fb->'corrections') is distinct from 'array' or jsonb_typeof(fb->'expressions') is distinct from 'array' then raise exception 'LEARNING_INVALID'; end if;
 if jsonb_array_length(fb->'corrections')>3 or jsonb_array_length(fb->'expressions')>10 then raise exception 'LEARNING_INVALID'; end if;
 for v in select value from jsonb_array_elements(fb->'corrections') loop
  if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['original','revised','reason']) or v-array['original','revised','reason']<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
  foreach f in array array['original','revised','reason'] loop
   if jsonb_typeof(v->f) is distinct from 'string' or length(btrim(v->>f))<1 or length(v->>f)>(case when f='reason' then 600 else 2000 end) then raise exception 'LEARNING_INVALID'; end if;
  end loop;
  if strpos(p_output->>'originalText',v->>'original')=0 then raise exception 'LEARNING_INVALID'; end if;
 end loop;
 for v in select value from jsonb_array_elements(fb->'expressions') loop
  if jsonb_typeof(v) is distinct from 'object' or not(v ?& array['phrase','meaning','example']) or v-array['phrase','meaning','example']<>'{}'::jsonb then raise exception 'LEARNING_INVALID'; end if;
  foreach f in array array['phrase','meaning','example'] loop
   if jsonb_typeof(v->f) is distinct from 'string' or length(btrim(v->>f))<1 or length(v->>f)>(case when f='phrase' then 200 when f='meaning' then 600 else 1000 end) then raise exception 'LEARNING_INVALID'; end if;
  end loop;
 end loop;
 if not exists(select 1 from storage.objects where bucket_id='learning-audio' and name=j.storage_path) then raise exception 'LEARNING_INVALID'; end if;
 update public.learning_speech set status='READY',reference_text=p_output->>'referenceText',original_text=p_output->>'originalText',feedback=fb,mime_type=p_output->>'mimeType',duration_seconds=(p_output->>'durationSeconds')::numeric,error_code=null,lease_token=null,lease_expires_at=null,updated_at=t where id=j.id;
 return true;
end;
$$;
create function public.speech_cleanup_candidates() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_speech; result jsonb;
begin
 -- Lock rows before reservation so KEEP either wins first or gets an explicit conflict.
 for j in select * from public.learning_speech s where status='DELETED' or (not keep_audio and ((expires_at<=clock_timestamp() and status in ('READY','FAILED')) or (status='UPLOADING' and created_at<clock_timestamp()-interval '1 hour'))) for update skip locked loop
  update learning_private.speech_audio set deleting_at=coalesce(deleting_at,clock_timestamp()) where id=j.id;
  if j.status='UPLOADING' then update public.learning_speech set status='FAILED',error_code='UPLOAD_EXPIRED',updated_at=clock_timestamp() where id=j.id; end if;
 end loop;
 update learning_private.speech_audio a set deleting_at=coalesce(deleting_at,clock_timestamp()) where not exists(select 1 from public.learning_speech s where s.id=a.id);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'storage_path',storage_path)),'[]') into result from
 (select a.id,a.storage_path from learning_private.speech_audio a where deleting_at is not null and (cleaned_at is null or exists(select 1 from storage.objects o where o.bucket_id='learning-audio' and o.name=a.storage_path)) order by deleting_at limit 100) c;
 return result;
end;
$$;
create function public.finish_speech_cleanup(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from learning_private.speech_audio where id=p_id and deleting_at is not null) then return false; end if;
 update public.learning_speech set storage_path=null,updated_at=clock_timestamp() where id=p_id;
 update learning_private.speech_audio set cleaned_at=clock_timestamp() where id=p_id;
 return true;
end;
$$;
revoke all on function public.learning_speech_command(jsonb),public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text),public.queue_speech_recording(uuid),public.speech_audio_path(uuid),public.speech_storage_allowed(text,jsonb,boolean) from public,anon,service_role;
grant execute on function public.learning_speech_command(jsonb),public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text),public.queue_speech_recording(uuid),public.speech_audio_path(uuid),public.speech_storage_allowed(text,jsonb,boolean) to authenticated;
revoke all on function public.claim_speech_job(),public.finish_speech_job(uuid,uuid,jsonb,text),public.speech_cleanup_candidates(),public.finish_speech_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.claim_speech_job(),public.finish_speech_job(uuid,uuid,jsonb,text),public.speech_cleanup_candidates(),public.finish_speech_cleanup(uuid) to service_role;
revoke all on all functions in schema learning_private from public,anon,authenticated;
