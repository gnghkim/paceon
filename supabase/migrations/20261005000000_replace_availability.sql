-- Replacing the weekly study budget must be one statement: several books share it,
-- and a half-written set would let the next plan be scheduled against a budget
-- the learner never chose. Runs as the caller, so RLS still limits it to own rows.
--
-- Rescheduling the affected plans is NOT part of this function. The caller checks
-- every active plan against the new budget first, then replans each one through
-- submit_book_progress, which reads these rules back when it verifies capacity.
create or replace function public.replace_availability_rules(p_rules jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rules) is distinct from 'array'
    or jsonb_array_length(p_rules) not between 1 and 7 then
    raise exception 'Invalid availability' using errcode = '23514';
  end if;
  if exists(
      select 1 from jsonb_array_elements(p_rules) a
      where jsonb_typeof(a->'isoWeekday') is distinct from 'number'
        or jsonb_typeof(a->'availableMinutes') is distinct from 'number'
        or (a->>'isoWeekday')::numeric <> trunc((a->>'isoWeekday')::numeric)
        or (a->>'availableMinutes')::numeric <> trunc((a->>'availableMinutes')::numeric)
        or (a->>'isoWeekday')::integer not between 1 and 7
        or (a->>'availableMinutes')::integer not between 1 and 1440)
    or (select count(distinct a->>'isoWeekday') from jsonb_array_elements(p_rules) a)
       <> jsonb_array_length(p_rules) then
    raise exception 'Invalid availability' using errcode = '23514';
  end if;
  delete from public.availability_rules where user_id = owner_id;
  insert into public.availability_rules(user_id, iso_weekday, available_minutes)
    select owner_id, (a->>'isoWeekday')::smallint, (a->>'availableMinutes')::integer
    from jsonb_array_elements(p_rules) a;
end;
$$;
revoke all on function public.replace_availability_rules(jsonb) from public, anon;
grant execute on function public.replace_availability_rules(jsonb) to authenticated;
