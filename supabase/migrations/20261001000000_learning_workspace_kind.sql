-- Each workspace belongs to one learning area. Kind is chosen at creation and never changes.
alter table public.learning_workspaces add column kind text;

create function learning_private.classify_workspace_kind(w public.learning_workspaces) returns text language sql stable set search_path='' as $$
 select case
  when exists(select 1 from public.learning_videos v where v.workspace_id=w.id) then 'LISTENING'
  when w.draft<>'' or exists(select 1 from public.learning_messages m where m.workspace_id=w.id) then 'WRITING'
  when exists(select 1 from public.learning_speech s where s.workspace_id=w.id) then 'SPEAKING'
  when w.title='나의 영어 말하기' then 'SPEAKING'
  else 'WRITING' end;
$$;
update public.learning_workspaces w set kind=learning_private.classify_workspace_kind(w);
alter table public.learning_workspaces alter column kind set not null;
alter table public.learning_workspaces add constraint learning_workspaces_kind check(kind in ('LISTENING','SPEAKING','WRITING'));
create index learning_workspaces_kind_recent on public.learning_workspaces(user_id,kind,updated_at desc,id desc);

-- Creation paths pass the kind through a transaction-local setting; direct inserts must name it.
create function learning_private.workspace_kind_default() returns trigger language plpgsql set search_path='' as $$
begin
 new.kind:=coalesce(new.kind,nullif(current_setting('paceon.workspace_kind',true),''));
 return new;
end;
$$;
create trigger learning_workspaces_kind_default before insert on public.learning_workspaces for each row execute function learning_private.workspace_kind_default();
create function learning_private.workspace_kind_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind is distinct from old.kind then raise exception 'LEARNING_KIND'; end if;
 return new;
end;
$$;
create trigger learning_workspaces_kind_immutable before update of kind on public.learning_workspaces for each row execute function learning_private.workspace_kind_immutable();

-- Missing or foreign workspaces pass through so the wrapped command keeps its NOT_FOUND contract.
create function learning_private.require_workspace_kind(p_workspace_id uuid,p_allowed text[]) returns void language plpgsql set search_path='' as $$
declare k text;
begin
 select kind into k from public.learning_workspaces where id=p_workspace_id and user_id=auth.uid();
 if found and not (k=any(p_allowed)) then raise exception 'LEARNING_KIND'; end if;
end;
$$;

alter function public.learning_command(jsonb) set schema learning_private;
alter function learning_private.learning_command(jsonb) rename to learning_command_admission;
create function public.learning_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_command->>'action'; k text; wid uuid; result jsonb;
begin
 if a='CREATE' then
  if jsonb_typeof(p_command->'kind') is distinct from 'string' or p_command->>'kind' not in ('SPEAKING','WRITING') then raise exception 'LEARNING_INVALID'; end if;
  k:=p_command->>'kind';
  perform set_config('paceon.workspace_kind',k,true);
  result:=learning_private.learning_command_admission(p_command-'kind');
  perform set_config('paceon.workspace_kind','',true);
  -- The core stores the command without kind, so a replay with another kind must be caught here.
  if result->'workspace' ? 'kind' and result->'workspace'->>'kind'<>k then raise exception 'LEARNING_CONFLICT'; end if;
  return result;
 end if;
 if a in ('SAVE_DRAFT','MESSAGE','SUMMARY') and jsonb_typeof(p_command->'workspaceId')='string' then
  perform learning_private.require_workspace_kind((p_command->>'workspaceId')::uuid,array['WRITING','LISTENING']);
 elsif a='RETRY' and jsonb_typeof(p_command->'jobId')='string' then
  select workspace_id into wid from public.learning_ai_jobs where id=(p_command->>'jobId')::uuid and user_id=auth.uid();
  if found then perform learning_private.require_workspace_kind(wid,array['WRITING','LISTENING']); end if;
 end if;
 return learning_private.learning_command_admission(p_command);
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_command(jsonb) to authenticated;

alter function public.learning_speech_command(jsonb) set schema learning_private;
alter function learning_private.learning_speech_command(jsonb) rename to speech_retention_command;
create function public.learning_speech_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_command->>'action'; wid uuid;
begin
 -- DELETE, DELETE_AUDIO and KEEP manage personal data and stay available in every area.
 if a='PROMPT' and jsonb_typeof(p_command->'workspaceId')='string' then
  wid:=(p_command->>'workspaceId')::uuid;
 elsif a in ('EDIT','RETRY') and jsonb_typeof(p_command->'id')='string' then
  select workspace_id into wid from public.learning_speech where id=(p_command->>'id')::uuid and user_id=auth.uid();
 elsif a='SPEECH_TICK' and jsonb_typeof(p_command->'sessionId')='string' then
  select workspace_id into wid from public.learning_sessions where id=(p_command->>'sessionId')::uuid and user_id=auth.uid();
 end if;
 if wid is not null then perform learning_private.require_workspace_kind(wid,array['SPEAKING','LISTENING']); end if;
 return learning_private.speech_retention_command(p_command);
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_speech_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_speech_command(jsonb) to authenticated;

alter function public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) set schema learning_private;
alter function learning_private.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) rename to begin_speech_upload_core;
create function public.begin_speech_upload(p_id uuid,p_workspace_id uuid,p_session_id uuid,p_reference_text text,p_mime_type text,p_file_size bigint,p_content_sha256 text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform learning_private.require_workspace_kind(p_workspace_id,array['SPEAKING','LISTENING']);
 return learning_private.begin_speech_upload_core(p_id,p_workspace_id,p_session_id,p_reference_text,p_mime_type,p_file_size,p_content_sha256);
end;
$$;
revoke all on function public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) from public,anon,service_role;
grant execute on function public.begin_speech_upload(uuid,uuid,uuid,text,text,bigint,text) to authenticated;

alter function public.learning_video_command(jsonb) set schema learning_private;
alter function learning_private.learning_video_command(jsonb) rename to learning_video_command_core;
create function public.learning_video_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=p_command->>'action'; wid uuid; result jsonb;
begin
 if a='VIDEO_ADD' then
  perform set_config('paceon.workspace_kind','LISTENING',true);
  result:=learning_private.learning_video_command_core(p_command);
  perform set_config('paceon.workspace_kind','',true);
  return result;
 end if;
 if jsonb_typeof(p_command->'workspaceId')='string' then
  wid:=(p_command->>'workspaceId')::uuid;
 elsif jsonb_typeof(p_command->'sessionId')='string' then
  select workspace_id into wid from public.learning_sessions where id=(p_command->>'sessionId')::uuid and user_id=auth.uid();
 end if;
 if wid is not null then perform learning_private.require_workspace_kind(wid,array['LISTENING']); end if;
 return learning_private.learning_video_command_core(p_command);
exception when invalid_text_representation then raise exception 'LEARNING_INVALID';
end;
$$;
revoke all on function public.learning_video_command(jsonb) from public,anon,service_role;
grant execute on function public.learning_video_command(jsonb) to authenticated;
revoke all on all functions in schema learning_private from public,anon,authenticated;
