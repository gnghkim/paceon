-- Speeds up learning_daily_minutes' per-user scan; the primary key alone is (session_id, started_at).
create index activity_segments_user_started on learning_private.activity_segments(user_id, started_at);

-- Splits one UTC interval into per-local-day seconds using the timezone stored on the segment,
-- so a later timezone preference change never reinterprets an already-recorded segment's date.
create function learning_private.segment_days(p_started timestamptz, p_ended timestamptz, p_tz text)
returns table(study_date date, seconds numeric) language sql immutable set search_path='' as $$
  select d::date,
    extract(epoch from (
      least(p_ended, (d + interval '1 day') at time zone p_tz) -
      greatest(p_started, d at time zone p_tz)
    ))
  from generate_series(
    date_trunc('day', p_started at time zone p_tz),
    date_trunc('day', p_ended at time zone p_tz),
    interval '1 day'
  ) as d
$$;

create function public.learning_daily_minutes(p_from date, p_to date) returns table(study_date date, minutes numeric)
language sql security definer set search_path='' as $$
  select sd.study_date, sum(sd.seconds)/60.0
  from learning_private.activity_segments a
  cross join lateral learning_private.segment_days(a.started_at, a.ended_at, a.timezone) sd
  where a.user_id=auth.uid() and sd.study_date between p_from and p_to
    and p_to>=p_from and p_to<=p_from+interval '366 days'
  group by sd.study_date
$$;
revoke all on function public.learning_daily_minutes(date,date) from public,anon;
grant execute on function public.learning_daily_minutes(date,date) to authenticated;
