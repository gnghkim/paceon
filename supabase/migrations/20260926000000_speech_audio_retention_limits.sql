alter table public.learning_speech add column audio_deleted_at timestamptz;
grant select(audio_deleted_at) on public.learning_speech to authenticated;
create or replace function learning_private.speech_admit(u uuid,k text) returns void language plpgsql set search_path='' as $$
begin
 if (select count(*) from public.learning_speech where user_id=u and status in ('UPLOADING','QUEUED','RUNNING'))+(select count(*) from public.learning_ai_jobs where user_id=u and status in ('QUEUED','RUNNING'))>=3
 or (select count(*) from learning_private.job_requests where user_id=u and created_at>clock_timestamp()-interval '1 minute')>=10
 or (select count(*) from learning_private.job_requests where user_id=u and kind in ('SPEECH_PROMPT','SPEECH_RECORDING') and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')>=30
 or (select count(*) from learning_private.job_requests where user_id=u and kind='SPEECH_'||k and created_at>=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC') >= (case when k='PROMPT' then 50 else 100 end) then raise exception 'LEARNING_LIMIT'; end if;
 insert into learning_private.job_requests(user_id,kind) values(u,'SPEECH_'||k);
end;
$$;
alter function public.learning_speech_command(jsonb) set schema learning_private;
alter function learning_private.learning_speech_command(jsonb) rename to speech_observation_command;
create function public.learning_speech_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); rid uuid; jid uuid; j public.learning_speech; prior learning_private.commands; result jsonb;
begin
 if p_command->>'action' is distinct from 'DELETE_AUDIO' then return learning_private.speech_observation_command(p_command); end if;
 if u is null or jsonb_typeof(p_command) is distinct from 'object' or not(p_command ?& array['action','requestId','id']) or p_command-array['action','requestId','id']<>'{}'::jsonb or jsonb_typeof(p_command->'requestId') is distinct from 'string' or jsonb_typeof(p_command->'id') is distinct from 'string' then raise exception 'LEARNING_INVALID'; end if;
 rid:=(p_command->>'requestId')::uuid; jid:=(p_command->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(u::text,9818));
 select * into prior from learning_private.commands where user_id=u and request_id=rid;
 if found and prior.command<>p_command then raise exception 'LEARNING_CONFLICT'; end if;
 select * into j from public.learning_speech where id=jid and user_id=u for update;
 if not found then raise exception 'LEARNING_NOT_FOUND'; end if;
 if j.status not in ('READY','FAILED') then raise exception 'LEARNING_CONFLICT'; end if;
 update learning_private.speech_audio set deleting_at=coalesce(deleting_at,clock_timestamp()) where id=jid;
 update public.learning_speech set keep_audio=false,audio_deleted_at=coalesce(audio_deleted_at,clock_timestamp()),updated_at=clock_timestamp() where id=jid returning * into j;
 result:=jsonb_build_object('item',learning_private.public_speech(j));
 insert into learning_private.commands(user_id,request_id,command,result) values(u,rid,p_command,result) on conflict(user_id,request_id) do nothing;
 return result;
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_speech_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_speech_command(jsonb) to authenticated;
create or replace function public.finish_speech_cleanup(p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from learning_private.speech_audio where id=p_id and deleting_at is not null) then return false; end if;
 update public.learning_speech set storage_path=null,audio_deleted_at=coalesce(audio_deleted_at,clock_timestamp()),updated_at=clock_timestamp() where id=p_id;
 update learning_private.speech_audio set cleaned_at=clock_timestamp() where id=p_id;
 return true;
end;
$$;
-- Admission after the core call remains in the same transaction, allowing cached replies
-- and command replays while rolling back a new job that would exceed shared capacity.
create or replace function public.learning_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; fresh boolean;
begin
 select not exists(select 1 from learning_private.commands where user_id=auth.uid() and request_id=(p_command->>'requestId')::uuid) into fresh;
 result:=learning_private.learning_command_core(p_command);
 if p_command->>'action' in ('MESSAGE','SUMMARY','RETRY') and
 (select count(*) from public.learning_speech where user_id=auth.uid() and status in ('UPLOADING','QUEUED','RUNNING'))+(select count(*) from public.learning_ai_jobs where user_id=auth.uid() and status in ('QUEUED','RUNNING'))>3 then raise exception 'LEARNING_LIMIT'; end if;
 if fresh and (p_command->>'action'='MESSAGE' or (p_command->>'action'='HEARTBEAT' and p_command->'activity'='true'::jsonb)) and exists(select 1 from public.learning_sessions where id=(p_command->>'sessionId')::uuid and user_id=auth.uid() and status='ACTIVE') then
  insert into learning_private.video_text_activity(session_id,observed_at) values((p_command->>'sessionId')::uuid,clock_timestamp()) on conflict(session_id) do update set observed_at=excluded.observed_at;
 end if;
 return result;
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
-- A completion cannot replace the sentence already used to synthesize an uploaded MP3.
alter function public.finish_speech_job(uuid,uuid,jsonb,text) set schema learning_private;
alter function learning_private.finish_speech_job(uuid,uuid,jsonb,text) rename to finish_speech_job_core;
create function public.finish_speech_job(p_job_id uuid,p_lease_token uuid,p_output jsonb,p_error_code text) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 select * into j from public.learning_speech where id=p_job_id for update;
 if found and j.kind='PROMPT' and j.status='RUNNING' and j.lease_token=p_lease_token and j.lease_expires_at>clock_timestamp() and p_error_code is null and j.reference_text<>'' and
 (j.reference_text is distinct from p_output->>'referenceText' or j.feedback->>'summary' is distinct from p_output->'feedback'->>'summary') then raise exception 'LEARNING_INVALID'; end if;
 return learning_private.finish_speech_job_core(p_job_id,p_lease_token,p_output,p_error_code);
end;
$$;
revoke all on function public.finish_speech_job(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_speech_job(uuid,uuid,jsonb,text) to service_role;
revoke all on all functions in schema learning_private from public,anon,authenticated;
