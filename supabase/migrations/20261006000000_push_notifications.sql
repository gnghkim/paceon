-- 매일 한 번 "오늘 할 분량" 알림. 알림을 켜지 않아도 앱의 모든 기능은 그대로 동작한다.
--
-- 보낼 대상 판단을 SQL에 두는 이유: Worker가 여러 번 돌거나 두 개가 잠깐 겹쳐도
-- 같은 사람에게 하루 두 번 울려서는 안 된다. 고르는 것과 표시하는 것을 한 문장에서 끝낸다.

alter table public.learner_profiles
  -- 알림 시각. NULL이면 알림을 보내지 않는다.
  add column notify_at time,
  -- 마지막으로 보낸 지역 날짜. 하루 한 번을 보장한다.
  add column notify_last_sent_on date;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 브라우저가 준 전송 주소. 기기·브라우저마다 하나이며 전역에서 유일하다.
  endpoint text not null unique check (length(endpoint) between 20 and 2000
    and endpoint like 'https://%'),
  p256dh text not null check (length(p256dh) between 20 and 200),
  auth text not null check (length(auth) between 10 and 100),
  -- 구독을 만든 화면이 보고한 시간대. 참고용이며 발송 기준은 프로필 시간대다.
  timezone text check (timezone is null or private.valid_timezone(timezone)),
  failure_count smallint not null default 0 check (failure_count between 0 and 32767),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_subscriptions_owner_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;
create policy owner_select on public.push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy owner_insert on public.push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy owner_update on public.push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy owner_delete on public.push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);
create trigger touch_updated_at before update on public.push_subscriptions
  for each row execute function private.touch_updated_at();

/**
 * 지금 이 사람에게 알림을 보낼 때인가.
 *
 * 시각끼리 더하면 자정을 넘을 때 값이 되감긴다(22:59 + 2시간 = 00:59). 그래서 지역 날짜에
 * 시각을 붙인 타임스탬프로 비교한다. 늦은 밤에 알림이 통째로 사라지던 문제를 막는다.
 *
 * 지정 시각에서 2시간이 지나면 건너뛴다. 자정 직전에 몰아 울리는 것보다 하루 거르는 편이 낫다.
 */
create function private.notification_due(
  p_local_now timestamp, p_notify_at time, p_last_sent date
) returns boolean language sql immutable set search_path = '' as $$
  select p_notify_at is not null
    and (p_last_sent is null or p_last_sent < p_local_now::date)
    and p_local_now >= (p_local_now::date + p_notify_at)
    and p_local_now < (p_local_now::date + p_notify_at + interval '2 hours');
$$;
revoke all on function private.notification_due(timestamp, time, date) from public, anon;
grant execute on function private.notification_due(timestamp, time, date) to authenticated, service_role;

/**
 * 지금 보낼 알림을 집어 온다.
 *
 * 사용자의 시간대에서 현재 시각이 notify_at을 지났고 오늘 아직 보내지 않았으면 대상이다.
 * 고르는 즉시 notify_last_sent_on을 오늘로 올린다. 전송이 실패해도 같은 날 다시 시도하지
 * 않는다. 알림은 놓쳐도 되는 정보이고, 두 번 울리는 쪽이 더 나쁘다.
 *
 * security invoker다. service_role만 EXECUTE 권한을 가지며 RLS를 우회해 모든 사용자를 본다.
 */
create function public.claim_due_notifications(p_limit integer default 50)
returns table (
  user_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  due_pages integer,
  goal_minutes integer
)
language plpgsql security invoker set search_path = '' as $$
declare
  claimed uuid[];
  size integer := case when p_limit is null or p_limit < 1 or p_limit > 500 then 50 else p_limit end;
begin
  with due as (
    select p.user_id, (now() at time zone p.timezone)::date as local_today
    from public.learner_profiles p
    where private.notification_due(
            now() at time zone p.timezone, p.notify_at, p.notify_last_sent_on)
      and exists (select 1 from public.push_subscriptions s where s.user_id = p.user_id)
    order by p.user_id
    limit size
    for update skip locked
  ), marked as (
    update public.learner_profiles p
      set notify_last_sent_on = due.local_today
      from due
      where p.user_id = due.user_id
      returning p.user_id as id
  )
  select coalesce(array_agg(marked.id), '{}'::uuid[]) into claimed from marked;

  return query
  select s.user_id, s.id, s.endpoint, s.p256dh, s.auth,
    coalesce((
      select sum(se.planned_workload)::integer
      from public.schedule_sessions se
      join public.plans pl on pl.id = se.plan_id
      where se.user_id = s.user_id
        and pl.status = 'ACTIVE'
        and se.study_date = (now() at time zone lp.timezone)::date
        and se.status in ('PLANNED', 'IN_PROGRESS')
    ), 0),
    lp.daily_learning_minutes::integer
  from public.push_subscriptions s
  join public.learner_profiles lp on lp.user_id = s.user_id
  where s.user_id = any(claimed)
  order by s.user_id, s.id;
end;
$$;
revoke all on function public.claim_due_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_due_notifications(integer) to service_role;

/** 전송 결과 반영. 구독이 사라졌으면(404/410) 지우고, 아니면 실패 횟수만 센다. */
create function public.finish_notification(p_subscription_id uuid, p_gone boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_gone then
    delete from public.push_subscriptions where id = p_subscription_id;
  else
    update public.push_subscriptions
      set failure_count = failure_count + 1
      where id = p_subscription_id;
    -- 열 번 연속 실패한 주소는 살아 돌아오지 않는다.
    delete from public.push_subscriptions
      where id = p_subscription_id and failure_count >= 10;
  end if;
end;
$$;
revoke all on function public.finish_notification(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_notification(uuid, boolean) to service_role;
