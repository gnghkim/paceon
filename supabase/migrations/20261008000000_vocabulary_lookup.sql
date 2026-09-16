-- 단어장: 공부하다 만난 단어를 적어 두면 AI가 뜻과 예문을 채운다.
--
-- 복습함과 같은 표를 쓴다. 단어와 표현을 따로 두면 같은 것을 두 번 저장하게 되고
-- 복습도 두 갈래가 된다. 다른 것은 "누가 뜻을 적었는가"뿐이다.

-- CHECK 식에는 서브쿼리를 쓸 수 없다. 원소 검사는 불변 함수로 빼서 호출한다.
create function private.valid_examples(p_examples text[])
returns boolean language sql immutable set search_path = '' as $$
  select p_examples is null
    or (coalesce(array_length(p_examples, 1), 0) <= 5
        and not exists (select 1 from unnest(p_examples) e
                        where e is null or length(btrim(e)) < 1 or length(e) > 500));
$$;
revoke all on function private.valid_examples(text[]) from public, anon;
grant execute on function private.valid_examples(text[]) to authenticated, service_role;

alter table public.learning_expressions
  -- 예문 여러 개. 기존 example은 더 쓰지 않으며 아래에서 옮겨 담는다.
  add column examples text[] not null default '{}'
    check (private.valid_examples(examples)),
  -- AI가 뜻을 채우는 중인지. NONE은 사용자가 직접 적었거나 이미 채워진 것이다.
  add column lookup_status text not null default 'NONE'
    check (lookup_status in ('NONE', 'QUEUED', 'RUNNING', 'READY', 'FAILED')),
  add column lookup_attempts smallint not null default 0
    check (lookup_attempts between 0 and 100),
  add column lease_token uuid,
  add column lease_expires_at timestamptz;

update public.learning_expressions
  set examples = array[example]
  where example is not null and length(btrim(example)) > 0;

-- 뜻은 채워지기 전까지 비어 있을 수 있다. 다 채운 카드에는 반드시 있어야 한다.
alter table public.learning_expressions alter column meaning drop not null;
alter table public.learning_expressions
  add constraint learning_expressions_meaning_when_settled
    check (lookup_status in ('QUEUED', 'RUNNING', 'FAILED')
           or (meaning is not null and length(btrim(meaning)) between 1 and 500));

create index learning_expressions_lookup_idx
  on public.learning_expressions(lookup_status, lease_expires_at)
  where lookup_status in ('QUEUED', 'RUNNING');

/**
 * 뜻을 찾을 단어를 하나 집어 온다. service_role 전용이다.
 *
 * 임대를 걸어 두 Worker가 같은 단어를 동시에 처리하지 않게 한다. 임대가 끝난
 * RUNNING은 다시 집어 갈 수 있으므로 Worker가 죽어도 단어가 묶인 채 남지 않는다.
 * 다섯 번 실패하면 FAILED로 두고 더 시도하지 않는다. 사용자가 직접 적으면 된다.
 */
create function public.claim_expression_lookup()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claimed public.learning_expressions;
begin
  update public.learning_expressions e
    set lookup_status = 'RUNNING',
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + interval '2 minutes',
        lookup_attempts = e.lookup_attempts + 1
    where e.id = (
      select id from public.learning_expressions
      where lookup_status = 'QUEUED'
         or (lookup_status = 'RUNNING' and lease_expires_at < now())
      order by created_at
      limit 1
      for update skip locked
    )
    returning * into claimed;
  if claimed.id is null then
    return null;
  end if;
  if claimed.lookup_attempts > 5 then
    update public.learning_expressions
      set lookup_status = 'FAILED', lease_token = null, lease_expires_at = null
      where id = claimed.id;
    return null;
  end if;
  return jsonb_build_object('id', claimed.id, 'phrase', claimed.phrase,
                            'lease_token', claimed.lease_token);
end;
$$;
revoke all on function public.claim_expression_lookup() from public, anon, authenticated;
grant execute on function public.claim_expression_lookup() to service_role;

/**
 * 찾은 뜻과 예문을 넣는다. 임대가 남아 있어야 하며, 늦게 온 결과는 버린다.
 * 실패하면 QUEUED로 되돌려 다음에 다시 시도한다.
 */
create function public.finish_expression_lookup(
  p_id uuid, p_lease_token uuid, p_meaning text, p_examples text[], p_failed boolean
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  current public.learning_expressions;
begin
  select * into current from public.learning_expressions
    where id = p_id and lease_token = p_lease_token and lookup_status = 'RUNNING'
    for update;
  if current.id is null then
    return false;
  end if;
  if p_failed or p_meaning is null or length(btrim(p_meaning)) = 0 then
    update public.learning_expressions
      set lookup_status = case when current.lookup_attempts >= 5 then 'FAILED' else 'QUEUED' end,
          lease_token = null, lease_expires_at = null
      where id = p_id;
    return true;
  end if;
  update public.learning_expressions
    set meaning = left(btrim(p_meaning), 500),
        examples = coalesce(p_examples, '{}'),
        lookup_status = 'READY',
        lease_token = null, lease_expires_at = null
    where id = p_id;
  return true;
end;
$$;
revoke all on function public.finish_expression_lookup(uuid, uuid, text, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.finish_expression_lookup(uuid, uuid, text, text[], boolean)
  to service_role;
