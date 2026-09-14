create function public.checkpoint_speech_prompt(p_job_id uuid,p_lease_token uuid,p_reference_text text,p_meaning text) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 select * into j from public.learning_speech where id=p_job_id for update;
 if not found or j.kind<>'PROMPT' or j.status<>'RUNNING' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then return false; end if;
 if p_reference_text is null or length(btrim(p_reference_text)) not between 1 and 8000 or p_meaning is null or length(btrim(p_meaning)) not between 1 and 2000 then raise exception 'LEARNING_INVALID'; end if;
 if j.reference_text<>'' then
  if j.reference_text<>p_reference_text or j.feedback->>'summary' is distinct from p_meaning then raise exception 'LEARNING_CONFLICT'; end if;
  return true;
 end if;
 update public.learning_speech set reference_text=p_reference_text,feedback=jsonb_build_object('summary',p_meaning,'corrections','[]'::jsonb,'expressions','[]'::jsonb,'nextPrompt',''),updated_at=clock_timestamp() where id=j.id;
 return true;
end;
$$;
revoke all on function public.checkpoint_speech_prompt(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.checkpoint_speech_prompt(uuid,uuid,text,text) to service_role;

create table learning_private.speech_observations(session_id uuid primary key references public.learning_sessions(id) on delete cascade,generation integer not null,playing boolean not null,observed_at timestamptz not null);
-- Preserve the existing command implementation and add the media observation boundary.
alter function public.learning_speech_command(jsonb) set schema learning_private;
alter function learning_private.learning_speech_command(jsonb) rename to speech_command_core;
create function public.learning_speech_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s public.learning_sessions; old learning_private.speech_observations; prior learning_private.commands; t timestamptz; rid uuid; sid uuid; f text; playing boolean; recent_text boolean; result jsonb;
begin
 if p_command->>'action' is distinct from 'SPEECH_TICK' then return learning_private.speech_command_core(p_command); end if;
 if u is null or jsonb_typeof(p_command) is distinct from 'object' or not(p_command ?& array['action','requestId','sessionId','deviceId','generation','playing']) or p_command-array['action','requestId','sessionId','deviceId','generation','playing']<>'{}'::jsonb
 or jsonb_typeof(p_command->'playing') is distinct from 'boolean' or jsonb_typeof(p_command->'generation') is distinct from 'number' or (p_command->>'generation') !~ '^[1-9][0-9]{0,8}$' then raise exception 'LEARNING_INVALID'; end if;
 foreach f in array array['requestId','sessionId','deviceId'] loop
  if jsonb_typeof(p_command->f) is distinct from 'string' then raise exception 'LEARNING_INVALID'; end if;
 end loop;
 rid:=(p_command->>'requestId')::uuid; sid:=(p_command->>'sessionId')::uuid; playing:=(p_command->>'playing')::boolean;
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818)); t:=clock_timestamp();
 select * into prior from learning_private.commands where user_id=u and request_id=rid;
 if found then
  if prior.command<>p_command then raise exception 'LEARNING_CONFLICT'; end if;
  return prior.result;
 end if;
 select * into s from public.learning_sessions where id=sid and user_id=u for update;
 if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
 if s.device_id<>(p_command->>'deviceId')::uuid or s.generation<>(p_command->>'generation')::integer or s.status='ENDED' or s.last_seen_at<t-interval '30 minutes' or (s.status='ACTIVE' and s.lease_expires_at<=t) then raise exception 'LEARNING_CONFLICT'; end if;
 select * into old from learning_private.speech_observations where session_id=sid;
 select exists(select 1 from learning_private.video_text_activity where session_id=sid and observed_at>t-interval '60 seconds') into recent_text;
 if old.generation=s.generation and old.playing and old.observed_at>t-interval '60 seconds' then
  perform learning_private.settle(u,t);
 elsif not recent_text then
  -- START reserves the shared lease; unobserved startup/wait time is not practice.
  update public.learning_sessions set last_seen_at=t where id=sid;
 end if;
 select * into s from public.learning_sessions where id=sid;
 if playing and (s.status='ACTIVE' or (s.status='PAUSED' and s.pause_reason='IDLE')) then
  if exists(select 1 from public.learning_sessions where user_id=u and status='ACTIVE' and id<>sid) then raise exception 'LEARNING_CONFLICT'; end if;
  update public.learning_sessions set status='ACTIVE',pause_reason=null,last_seen_at=t,last_activity_at=t,lease_expires_at=t+interval '60 seconds',updated_at=t where id=sid returning * into s;
 elsif not playing and not recent_text and s.status='ACTIVE' then
  update public.learning_sessions set status='PAUSED',pause_reason='IDLE',last_seen_at=t,lease_expires_at=t,updated_at=t where id=sid returning * into s;
 end if;
 insert into learning_private.speech_observations values(sid,s.generation,playing and s.status='ACTIVE',t) on conflict(session_id) do update set generation=excluded.generation,playing=excluded.playing,observed_at=excluded.observed_at;
 -- Speech takes media ownership; a later VIDEO_TICK cannot credit a pre-speech observation.
 update learning_private.video_observations set playing=false,observed_at=t where session_id=sid;
 result:=jsonb_build_object('session',to_jsonb(s));
 insert into learning_private.commands(user_id,request_id,command,result) values(u,rid,p_command,result);
 return result;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_speech_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_speech_command(jsonb) to authenticated;
-- Text activity applies to speech workspaces as well as YouTube workspaces.
alter function public.learning_command(jsonb) set schema learning_private;
alter function learning_private.learning_command(jsonb) rename to learning_command_core;
create function public.learning_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=learning_private.learning_command_core(p_command);
 if (p_command->>'action'='MESSAGE' or (p_command->>'action'='HEARTBEAT' and p_command->'activity'='true'::jsonb)) and exists(select 1 from public.learning_sessions where id=(p_command->>'sessionId')::uuid and user_id=auth.uid() and status='ACTIVE') then
  insert into learning_private.video_text_activity(session_id,observed_at) values((p_command->>'sessionId')::uuid,clock_timestamp()) on conflict(session_id) do update set observed_at=excluded.observed_at;
 end if;
 return result;
end;
$$;
revoke all on function public.learning_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_command(jsonb) to authenticated;
revoke all on all functions in schema learning_private from public,anon,authenticated;

create or replace function public.speech_audio_path(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 select * into j from public.learning_speech where id=p_id and user_id=auth.uid() and status<>'DELETED';
 if not found or j.storage_path is null or (not j.keep_audio and j.expires_at<=clock_timestamp()) or exists(select 1 from learning_private.speech_audio where id=p_id and deleting_at is not null) then raise exception 'LEARNING_NOT_FOUND'; end if;
 return jsonb_build_object('storage_path',j.storage_path,'mime_type',j.mime_type);
end;
$$;
create or replace function public.speech_storage_allowed(p_name text,p_metadata jsonb,p_write boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 select * into j from public.learning_speech where storage_path=p_name and user_id=auth.uid() for share;
 if not found or j.status='DELETED' or (not j.keep_audio and j.expires_at<=clock_timestamp()) or exists(select 1 from learning_private.speech_audio where id=j.id and deleting_at is not null) then return false; end if;
 if not p_write then return true; end if;
 return j.kind='RECORDING' and j.status='UPLOADING' and p_metadata->>'size'=j.file_size::text and p_metadata->>'mimetype'=j.mime_type;
end;
$$;
create index speech_audio_cleanup on learning_private.speech_audio(deleting_at,cleaned_at);
create or replace function public.speech_cleanup_candidates() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_speech; result jsonb;
begin
 for j in select s.* from public.learning_speech s join learning_private.speech_audio a on a.id=s.id where a.deleting_at is null and (status='DELETED' or (not keep_audio and ((expires_at<=clock_timestamp() and status in ('READY','FAILED')) or (status='UPLOADING' and created_at<clock_timestamp()-interval '1 hour')))) order by s.created_at for update of s skip locked limit 100 loop
  update learning_private.speech_audio set deleting_at=clock_timestamp() where id=j.id;
  if j.status='UPLOADING' then update public.learning_speech set status='FAILED',error_code='UPLOAD_EXPIRED',updated_at=clock_timestamp() where id=j.id; end if;
 end loop;
 update learning_private.speech_audio set deleting_at=clock_timestamp() where id in (select a.id from learning_private.speech_audio a where deleting_at is null and not exists(select 1 from public.learning_speech s where s.id=a.id) limit 100);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'storage_path',storage_path)),'[]') into result from
 (select a.id,a.storage_path from learning_private.speech_audio a where deleting_at is not null and (cleaned_at is null or exists(select 1 from storage.objects o where o.bucket_id='learning-audio' and o.name=a.storage_path)) order by deleting_at limit 100) c;
 return result;
end;
$$;
