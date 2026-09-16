-- A daily English-study target the Today screen compares against the timer.
-- NULL means the learner has not set one, and no screen shows a target then.
-- The value is a gentle goal, never a constraint on the scheduler or statistics.
alter table public.learner_profiles
  add column daily_learning_minutes smallint
    check (daily_learning_minutes between 1 and 1440);
