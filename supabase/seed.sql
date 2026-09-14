-- Local-only, non-login fixtures. No passwords or identities are provisioned.
insert into auth.users(id,email) values
  ('a0000000-0000-4000-8000-000000000001','alice@paceon.example'),
  ('a0000000-0000-4000-8000-000000000002','bob@paceon.example')
on conflict (id) do nothing;

insert into public.learner_profiles(user_id,timezone) values
  ('a0000000-0000-4000-8000-000000000001','Asia/Seoul'),
  ('a0000000-0000-4000-8000-000000000002','America/New_York')
on conflict (user_id) do nothing;

insert into public.resources(id,user_id,title,type,total_pages,initial_completed_workload) values
  ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','PaceOn 개발용 책 320p','BOOK',320,80),
  ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','사용자 격리 확인용 책','BOOK',100,0)
on conflict (id) do nothing;

insert into public.resource_units(id,user_id,resource_id,title,sequence,unit_type,start_page,end_page,workload) values
  ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','첫 학습 분량',1,'PAGE_RANGE',81,100,20),
  ('c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','첫 학습 분량',1,'PAGE_RANGE',1,20,20)
on conflict (id) do nothing;

insert into public.goals(id,user_id,resource_id,title,start_date,target_date,mode,preferred_daily_workload) values
  ('d0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','내 페이스로 완독',date '2026-09-14',date '2026-09-29','PACE',20),
  ('d0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','독립된 학습 목표',date '2026-09-14',null,'PACE',20)
on conflict (id) do nothing;

insert into public.availability_rules(user_id,iso_weekday,available_minutes)
select u.id, day, 60 from (values
  ('a0000000-0000-4000-8000-000000000001'::uuid),
  ('a0000000-0000-4000-8000-000000000002'::uuid)) u(id)
cross join generate_series(1,5) day
on conflict (user_id,iso_weekday) do nothing;

insert into public.plans(id,user_id,resource_id,goal_id,start_date,target_date,forecast_date,timezone,mode,preferred_daily_workload) values
  ('e0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',date '2026-09-14',date '2026-09-29',date '2026-09-29','Asia/Seoul','PACE',20),
  ('e0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002',date '2026-09-14',null,date '2026-09-18','America/New_York','PACE',20)
on conflict (id) do nothing;

insert into public.schedule_sessions(id,user_id,resource_id,plan_id,study_date,planned_workload,start_page,end_page) values
  ('f0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',date '2026-09-14',20,81,100),
  ('f0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002',date '2026-09-14',20,1,20)
on conflict (id) do nothing;

-- No simulated learning or AI result: fixtures begin with initial progress only.
