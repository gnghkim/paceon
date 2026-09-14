-- OAuth credentials never enter public tables or user-readable API responses.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.youtube_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  generation uuid not null,
  tokens text,
  state_hash text unique,
  binding_hash text,
  verifier text,
  state_expires timestamptz,
  updated_at timestamptz not null default now()
);
alter table private.youtube_connections enable row level security;
revoke all on private.youtube_connections from public, anon, authenticated;

create function public.youtube_connection_command(p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_action text := p_command->>'action';
  v_user uuid := (p_command->>'userId')::uuid;
  v_row private.youtube_connections%rowtype;
begin
  -- Function execution grants below are the trust boundary; no user token may call this.
  if v_action = 'consume' then
    select * into v_row from private.youtube_connections
      where state_hash = p_command->>'stateHash'
        and binding_hash = p_command->>'bindingHash'
        and state_expires > now() for update;
    if not found then return null; end if;
    update private.youtube_connections set state_hash=null,binding_hash=null,state_expires=null
      where user_id=v_row.user_id;
    return jsonb_build_object('user_id',v_row.user_id,'generation',v_row.generation,'verifier',v_row.verifier);
  end if;
  if v_user is null then raise exception 'user required'; end if;
  -- Serialize begin/disconnect even when the row does not yet exist.
  perform pg_advisory_xact_lock(hashtextextended('youtube:' || v_user::text, 0));
  if v_action = 'begin' then
    insert into private.youtube_connections(user_id,generation,state_hash,binding_hash,verifier,state_expires)
      values(v_user,(p_command->>'generation')::uuid,p_command->>'stateHash',p_command->>'bindingHash',p_command->>'verifier',now()+interval '10 minutes')
    on conflict(user_id) do update set generation=excluded.generation,state_hash=excluded.state_hash,
      binding_hash=excluded.binding_hash,verifier=excluded.verifier,state_expires=excluded.state_expires,updated_at=now();
    return '{}'::jsonb;
  elsif v_action = 'get' then
    select * into v_row from private.youtube_connections where user_id=v_user and tokens is not null;
    if not found then return null; end if;
    return jsonb_build_object('user_id',v_row.user_id,'generation',v_row.generation,'tokens',v_row.tokens);
  elsif v_action = 'commit' then
    update private.youtube_connections set tokens=p_command->>'tokens',verifier=null,updated_at=now()
      where user_id=v_user and generation=(p_command->>'generation')::uuid and state_hash is null and verifier is not null;
    return to_jsonb(found);
  elsif v_action = 'refresh' then
    update private.youtube_connections set tokens=p_command->>'tokens',updated_at=now()
      where user_id=v_user and generation=(p_command->>'generation')::uuid and tokens=p_command->>'previous';
    return to_jsonb(found);
  elsif v_action = 'invalidate' then
    update private.youtube_connections set tokens=null,updated_at=now()
      where user_id=v_user and generation=(p_command->>'generation')::uuid and tokens=p_command->>'previous';
    return to_jsonb(found);
  elsif v_action = 'disconnect' then
    delete from private.youtube_connections where user_id=v_user returning * into v_row;
    if not found then return null; end if;
    return jsonb_build_object('user_id',v_row.user_id,'generation',v_row.generation,'tokens',v_row.tokens);
  end if;
  raise exception 'unsupported command';
end;
$$;
revoke all on function public.youtube_connection_command(jsonb) from public, anon, authenticated;
grant execute on function public.youtube_connection_command(jsonb) to service_role;
