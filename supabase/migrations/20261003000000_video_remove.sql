-- Removing a saved video takes the video row only. The workspace, its sessions and the
-- settled study time stay, so past statistics and the heatmap keep the same numbers.
create or replace function learning_private.learning_video_command_core(p_command jsonb) returns jsonb
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
 when 'VIDEO_REMOVE' then array['action','requestId','workspaceId']
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
  elsif a='VIDEO_REMOVE' then
   -- Only the video row goes. learning_workspaces, learning_sessions and the settled
   -- activity_segments stay untouched so recorded study time survives the removal.
   delete from public.learning_videos where workspace_id=wid and user_id=u;
   result:=jsonb_build_object('removed',to_jsonb(v));
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
revoke all on function learning_private.learning_video_command_core(jsonb) from public,anon,authenticated,service_role;
