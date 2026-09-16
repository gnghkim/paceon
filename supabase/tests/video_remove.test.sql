begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();

insert into auth.users(id,email) values
 ('20000000-0000-4000-8000-000000000101','remove-fixture@paceon.example'),
 ('20000000-0000-4000-8000-000000000102','remove-other@paceon.example');
create temporary table remove_fixture(k text primary key,v jsonb);
grant all on remove_fixture to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000101',true);

-- A saved video with a study session and a settled activity segment behind it.
insert into remove_fixture values('add',jsonb_build_object(
 'action','VIDEO_ADD','requestId','20000000-0000-4000-8000-000000000110','workspaceId','20000000-0000-4000-8000-000000000111',
 'videoId','aqzKEbpKQ01','startSeconds',0,'title','YouTube · aqzKEbpKQ01'));
select lives_ok($$select learning_video_command((select v from remove_fixture where k='add'))$$,'Video saved');
insert into remove_fixture select 'start',jsonb_build_object('action','START','requestId',gen_random_uuid(),
 'workspaceId','20000000-0000-4000-8000-000000000111','deviceId',gen_random_uuid(),'timezone','Asia/Seoul');
insert into remove_fixture select 'session',learning_command(v)->'session' from remove_fixture where k='start';
reset role;
insert into learning_private.activity_segments(session_id,user_id,started_at,ended_at,timezone)
select (v->>'id')::uuid,'20000000-0000-4000-8000-000000000101',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes','Asia/Seoul'
from remove_fixture where k='session';
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000101',true);

-- Rejections come before anything is deleted.
select throws_ok($$select learning_video_command(jsonb_build_object('action','VIDEO_REMOVE','requestId',gen_random_uuid(),'workspaceId','20000000-0000-4000-8000-000000000111','extra',1))$$,
 'P0001','LEARNING_INVALID','VIDEO_REMOVE rejects an extra key');
select throws_ok($$select learning_video_command(jsonb_build_object('action','VIDEO_REMOVE','requestId',gen_random_uuid(),'workspaceId',gen_random_uuid()))$$,
 'P0001','LEARNING_NOT_FOUND','VIDEO_REMOVE needs a video of this user');

-- Another user cannot remove someone else's video.
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000102',true);
select throws_ok($$select learning_video_command(jsonb_build_object('action','VIDEO_REMOVE','requestId',gen_random_uuid(),'workspaceId','20000000-0000-4000-8000-000000000111'))$$,
 'P0001','LEARNING_NOT_FOUND','VIDEO_REMOVE is scoped to the owner');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000101',true);
select is((select count(*) from learning_videos where workspace_id='20000000-0000-4000-8000-000000000111'),1::bigint,'Video survives a foreign removal attempt');

-- The removal itself, and the replay of the same request.
insert into remove_fixture values('remove',jsonb_build_object(
 'action','VIDEO_REMOVE','requestId','20000000-0000-4000-8000-000000000120','workspaceId','20000000-0000-4000-8000-000000000111'));
insert into remove_fixture select 'removed',learning_video_command(v) from remove_fixture where k='remove';
select is((select v->'removed'->>'video_id' from remove_fixture where k='removed'),'aqzKEbpKQ01','Removal returns the video it took');
select is(learning_video_command((select v from remove_fixture where k='remove')),(select v from remove_fixture where k='removed'),'Same request replays the stored result');

-- What must stay: the workspace, the session and the settled study time.
select is((select count(*) from learning_videos where workspace_id='20000000-0000-4000-8000-000000000111'),0::bigint,'Video row is gone');
select is((select count(*) from learning_workspaces where id='20000000-0000-4000-8000-000000000111'),1::bigint,'Workspace stays');
select is((select count(*) from learning_sessions where workspace_id='20000000-0000-4000-8000-000000000111'),1::bigint,'Session stays');
-- activity_segments lives in learning_private, which authenticated cannot read.
reset role;
select is((select count(*) from learning_private.activity_segments a join public.learning_sessions s on s.id=a.session_id
 where s.workspace_id='20000000-0000-4000-8000-000000000111'),1::bigint,'Settled study time stays');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000101',true);

-- The same link can be saved again; it becomes a new workspace.
select lives_ok($$select learning_video_command(jsonb_build_object('action','VIDEO_ADD','requestId',gen_random_uuid(),'workspaceId',gen_random_uuid(),'videoId','aqzKEbpKQ01','startSeconds',0,'title','YouTube · aqzKEbpKQ01'))$$,
 'The same video can be saved again after removal');
select is((select count(*) from learning_videos where user_id='20000000-0000-4000-8000-000000000101' and video_id='aqzKEbpKQ01'),1::bigint,'Re-saving makes one fresh row');

select * from finish();
rollback;
