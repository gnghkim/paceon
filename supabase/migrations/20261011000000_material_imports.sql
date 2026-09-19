-- 링크를 주면 AI가 목차와 일정을 제안한다.
--
-- 웹 서버가 사용자가 준 공개 페이지 하나를 읽어 글만 뽑아 여기에 줄을 세우고, Worker가
-- 집어 가 AI에게 목차 정리를 맡긴 뒤 결과를 돌려놓는다. 단어장의 뜻 찾기와 같은 구조다.
--
-- 여기에 쌓이는 것은 제안일 뿐이다. 자료는 사용자가 화면에서 확인하고 고친 뒤에 만든다.
-- 페이지의 글은 남의 것이고 오래 둘 이유가 없어 일주일이 지나면 지운다.

create table public.material_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_url text not null check (length(source_url) between 1 and 2000),
  page_title text check (page_title is null or length(page_title) <= 300),
  -- 페이지에서 뽑은 글. 신뢰할 수 없는 자료이며 AI에게도 그렇게 넘긴다.
  input text not null check (length(input) between 1 and 60000),
  -- 일정 제안에 쓸 숫자들(요일별 가용 시간 등). 개인을 알아볼 내용은 넣지 않는다.
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object' and length(context::text) <= 4000),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'READY', 'FAILED')),
  attempts smallint not null default 0 check (attempts between 0 and 100),
  lease_token uuid,
  lease_expires_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and length(result::text) <= 200000)),
  error_code text check (error_code is null or length(error_code) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'READY' or result is not null)
);
create index material_imports_queue_idx on public.material_imports(status, lease_expires_at)
  where status in ('QUEUED', 'RUNNING');
create index material_imports_owner_idx on public.material_imports(user_id, created_at desc);

alter table public.material_imports enable row level security;
revoke all on public.material_imports from anon, authenticated;
grant select on public.material_imports to authenticated;
-- 사용자는 줄을 세울 수만 있다. 상태와 결과는 기본값으로 들어가고 Worker만 바꾼다.
grant insert (user_id, source_url, page_title, input, context) on public.material_imports to authenticated;
grant all on public.material_imports to service_role;
create policy owner_select on public.material_imports for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_insert on public.material_imports for insert to authenticated
  with check ((select auth.uid()) = user_id);
create trigger touch_updated_at before update on public.material_imports
  for each row execute function private.touch_updated_at();

/**
 * 하루에 요청할 수 있는 횟수를 막는다. 요청 하나가 AI 호출 하나다.
 * 웹에서도 확인하지만, 비용을 지키는 문은 웹을 거치지 않는 길에서도 닫혀 있어야 한다.
 */
create function private.limit_material_imports() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.material_imports
      where user_id = new.user_id and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'IMPORT_LIMIT' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_material_imports() from public;
create trigger limit_daily before insert on public.material_imports
  for each row execute function private.limit_material_imports();

/**
 * 정리할 요청을 하나 집어 온다. service_role 전용이다.
 * 임대가 끝난 RUNNING은 다시 집어 갈 수 있고, 세 번 실패하면 FAILED로 둔다.
 * 집어 가는 김에 일주일 넘은 줄을 지운다. 남의 페이지 글을 오래 들고 있지 않는다.
 */
create function public.claim_material_import()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed public.material_imports;
begin
  delete from public.material_imports where created_at < now() - interval '7 days';
  update public.material_imports m
    set status = 'RUNNING', lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '3 minutes', attempts = m.attempts + 1
    where m.id = (
      select id from public.material_imports
      where status = 'QUEUED' or (status = 'RUNNING' and lease_expires_at < now())
      order by created_at limit 1 for update skip locked)
    returning * into claimed;
  if claimed.id is null then return null; end if;
  if claimed.attempts > 3 then
    update public.material_imports
      set status = 'FAILED', error_code = coalesce(error_code, 'RETRIES_EXHAUSTED'), lease_token = null, lease_expires_at = null
      where id = claimed.id;
    return null;
  end if;
  return jsonb_build_object('id', claimed.id, 'lease_token', claimed.lease_token,
    'input', claimed.input, 'page_title', claimed.page_title, 'context', claimed.context);
end;
$$;
revoke all on function public.claim_material_import() from public, anon, authenticated;
grant execute on function public.claim_material_import() to service_role;

/** 결과를 넣는다. 임대가 맞아야 하며 늦게 온 결과는 버린다. 실패하면 다시 줄을 세운다. */
create function public.finish_material_import(p_id uuid, p_lease_token uuid, p_result jsonb, p_error_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current public.material_imports;
begin
  select * into current from public.material_imports
    where id = p_id and lease_token = p_lease_token and status = 'RUNNING' for update;
  if current.id is null then return false; end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    update public.material_imports
      set status = case when current.attempts >= 3 then 'FAILED' else 'QUEUED' end,
          error_code = left(coalesce(p_error_code, 'UNKNOWN'), 50), lease_token = null, lease_expires_at = null
      where id = p_id;
    return true;
  end if;
  update public.material_imports
    set status = 'READY', result = p_result, error_code = null, lease_token = null, lease_expires_at = null,
        -- 정리가 끝나면 페이지의 글은 더 필요 없다.
        input = '-'
    where id = p_id;
  return true;
end;
$$;
revoke all on function public.finish_material_import(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.finish_material_import(uuid, uuid, jsonb, text) to service_role;
