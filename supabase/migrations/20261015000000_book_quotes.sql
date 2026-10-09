-- 문장 기록: 책을 읽다가, 또는 읽고 나서 남기고 싶은 문장을 쪽과 함께 적어 둔다.
--
-- 회상 카드(learning_expressions의 RECALL)와 다르다. 회상은 책을 덮고 떠올린 것을
-- 간격을 두고 다시 묻는 복습 카드이고, 문장은 책에 있는 그대로를 모아 두는 것이다.
-- 복습에 넣지 않으므로 복습 표가 아니라 따로 둔다.

create table public.book_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  resource_id uuid not null,
  page integer not null check (page between 1 and 1000000),
  content text not null check (length(btrim(content)) between 1 and 2000),
  -- 그 문장에 붙이는 내 생각. 없어도 된다.
  note text check (note is null or length(btrim(note)) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 남의 책을 가리킬 수 없게 소유자까지 함께 묶는다. 책을 지우면 문장도 지워진다.
  constraint book_quotes_resource_fk
    foreign key (resource_id, user_id) references public.resources(id, user_id)
    on delete cascade
);

create index book_quotes_resource_idx on public.book_quotes(user_id, resource_id, page, created_at);

-- 쪽으로 읽는 책에만, 그 책의 쪽 안에서만 남긴다.
create function private.validate_book_quote() returns trigger
language plpgsql set search_path = '' as $$
declare
  book public.resources;
begin
  select * into book from public.resources where id = new.resource_id and user_id = new.user_id;
  if not found then raise exception 'Resource reference does not exist' using errcode = '23503'; end if;
  if book.workload_unit <> 'PAGE' then
    raise exception 'Quotes belong to books read by page' using errcode = '23514';
  end if;
  if book.total_pages is not null and new.page > book.total_pages then
    raise exception 'Page is outside the book' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_book_quote before insert or update on public.book_quotes
for each row execute function private.validate_book_quote();
create trigger touch_updated_at before update on public.book_quotes
for each row execute function private.touch_updated_at();

alter table public.book_quotes enable row level security;
revoke all on public.book_quotes from anon, authenticated;
grant select, insert, update, delete on public.book_quotes to authenticated;
grant all on public.book_quotes to service_role;
create policy owner_select on public.book_quotes for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_insert on public.book_quotes for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy owner_update on public.book_quotes for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.book_quotes for delete to authenticated
  using ((select auth.uid()) = user_id);
