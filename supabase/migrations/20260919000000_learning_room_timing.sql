-- Preserve subsecond activity across heartbeats and allocate worker leases after cleanup waits.
create or replace function learning_private.settle(p_user uuid,p_now timestamptz) returns void
language plpgsql set search_path='' as $$
begin
 insert into learning_private.activity_segments(session_id,user_id,started_at,ended_at,timezone)
 select id,user_id,last_seen_at,least(p_now,lease_expires_at,last_activity_at+interval '60 seconds'),timezone
 from public.learning_sessions where user_id=p_user and status='ACTIVE' and last_seen_at<least(p_now,lease_expires_at,last_activity_at+interval '60 seconds');
 update public.learning_sessions s set
 -- Round once over the retained exact UTC intervals, never once per heartbeat.
 -- The activity_segments primary key supports this session-scoped aggregation.
 elapsed_seconds=case when status='ACTIVE' then coalesce((
  select floor(sum(extract(epoch from a.ended_at-a.started_at)))::integer
  from learning_private.activity_segments a where a.session_id=s.id
 ),0) else elapsed_seconds end,
 status=case when last_seen_at<=p_now-interval '30 minutes' then 'ENDED' when status='ACTIVE' and (lease_expires_at<=p_now or last_activity_at<=p_now-interval '60 seconds') then 'PAUSED' else status end,
 pause_reason=case when last_seen_at<=p_now-interval '30 minutes' then null when status='ACTIVE' and (lease_expires_at<=p_now or last_activity_at<=p_now-interval '60 seconds') then 'EXPIRED' else pause_reason end,
 ended_at=case when last_seen_at<=p_now-interval '30 minutes' then greatest(last_seen_at,least(lease_expires_at,last_activity_at+interval '60 seconds')) else ended_at end,
 last_seen_at=case when status='ACTIVE' then least(p_now,lease_expires_at,last_activity_at+interval '60 seconds') else last_seen_at end,
 updated_at=p_now where user_id=p_user and status<>'ENDED';
end;
$$;

create or replace function public.claim_learning_job() returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.learning_ai_jobs; t timestamptz:=clock_timestamp();
begin
 -- Avoid one finishing worker blocking the queue while expired final attempts are reaped.
 with expired as (
  select id from public.learning_ai_jobs
  where status='RUNNING' and lease_expires_at<=t and attempts>=3
  for update skip locked
 )
 update public.learning_ai_jobs q set status='FAILED',error_code='LEASE_EXPIRED',lease_token=null,lease_expires_at=null,updated_at=t
 from expired where q.id=expired.id;
 t:=clock_timestamp();
 select * into j from public.learning_ai_jobs
 where attempts<3 and (status='QUEUED' or (status='RUNNING' and lease_expires_at<=t))
 order by created_at for update skip locked limit 1;
 if not found then return null; end if;
 -- Base the full three-minute lease on actual ownership acquisition, after any cleanup delay.
 t:=clock_timestamp();
 update public.learning_ai_jobs set status='RUNNING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=t+interval '3 minutes',updated_at=t
 where id=j.id returning * into j;
 return to_jsonb(j);
end;
$$;
revoke all on function learning_private.settle(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_learning_job() from public,anon,authenticated;
grant execute on function public.claim_learning_job() to service_role;
