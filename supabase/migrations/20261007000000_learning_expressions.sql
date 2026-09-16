-- 사용자가 직접 고른 표현만 복습 대상이 된다. AI가 만든 표현을 자동으로 넣지 않는다.
--
-- 간격을 두고 기억에서 꺼내 보는 연습이 설계 원칙이다. 간격 값(1·3·7·14·30일)은
-- 제품 기본값이며 누구에게나 최적인 주기라는 주장이 아니다. 간격 계산은 웹에서 하고
-- 여기서는 결과만 검증해 저장한다.

create table public.learning_expressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phrase text not null check (length(btrim(phrase)) between 1 and 200),
  meaning text not null check (length(btrim(meaning)) between 1 and 500),
  -- 저장할 때 함께 본 예문. 없을 수 있다.
  example text check (example is null or length(example) between 1 and 1000),
  -- 어느 학습에서 가져왔는지. 공간이 지워져도 표현은 남는다.
  source_workspace_id uuid references public.learning_workspaces(id) on delete set null,
  -- 지금 쓰는 간격의 위치. 0이 첫 간격이다.
  review_step smallint not null default 0 check (review_step between 0 and 4),
  due_on date not null check (isfinite(due_on)),
  last_reviewed_on date check (last_reviewed_on is null or isfinite(last_reviewed_on)),
  review_count integer not null default 0 check (review_count between 0 and 2147483647),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 같은 표현을 두 번 저장하지 않는다. 합치지도 않고, 이미 있다고 알려 준다.
  unique (user_id, phrase)
);
create index learning_expressions_due_idx on public.learning_expressions(user_id, due_on, id);

alter table public.learning_expressions enable row level security;
revoke all on public.learning_expressions from anon, authenticated;
grant select, insert, update, delete on public.learning_expressions to authenticated;
grant all on public.learning_expressions to service_role;
create policy owner_select on public.learning_expressions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_insert on public.learning_expressions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy owner_update on public.learning_expressions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.learning_expressions for delete to authenticated
  using ((select auth.uid()) = user_id);
create trigger touch_updated_at before update on public.learning_expressions
  for each row execute function private.touch_updated_at();

/**
 * 복습 결과를 기록한다.
 *
 * 다음 간격은 호출자가 계산해 넘긴다. 여기서는 그 값이 표 안에 있는지, 예정일이
 * 과거로 가지 않는지만 확인한다. 같은 카드를 하루에 여러 번 답해도 기록은 남되
 * 예정일은 마지막 답을 따른다.
 */
create function public.record_expression_review(
  p_id uuid, p_step smallint, p_due_on date, p_today date
) returns public.learning_expressions
language plpgsql security invoker set search_path = '' as $$
declare
  updated public.learning_expressions;
begin
  if p_step is null or p_step < 0 or p_step > 4
     or p_due_on is null or not isfinite(p_due_on)
     or p_today is null or not isfinite(p_today)
     or p_due_on <= p_today or p_due_on > p_today + 400 then
    raise exception 'Invalid review' using errcode = '23514';
  end if;
  update public.learning_expressions
    set review_step = p_step,
        due_on = p_due_on,
        last_reviewed_on = p_today,
        review_count = least(review_count + 1, 2147483647)
    where id = p_id
    returning * into updated;
  if updated.id is null then
    raise exception 'Expression not found' using errcode = 'P0002';
  end if;
  return updated;
end;
$$;
revoke all on function public.record_expression_review(uuid, smallint, date, date) from public, anon;
grant execute on function public.record_expression_review(uuid, smallint, date, date) to authenticated;
