create or replace function learning_private.speech_observation_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if recent_text or (old.generation=s.generation and old.playing and old.observed_at>t-interval '60 seconds') then
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
