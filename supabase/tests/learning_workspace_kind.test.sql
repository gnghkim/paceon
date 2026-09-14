begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_column('public','learning_workspaces','kind','Workspace kind exists');
select col_not_null('public','learning_workspaces','kind','Workspace kind is required');
insert into auth.users(id,email) values('30000000-0000-4000-8000-000000000001','kind-owner@paceon.example');
insert into learning_workspaces(id,user_id,title,kind,draft) values
('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Video','LISTENING',''),
('31000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','Mixed','WRITING',''),
('31000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','Draft only','WRITING','I went home.'),
('31000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','Speech only','WRITING',''),
('31000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001','나의 영어 말하기','WRITING',''),
('31000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000001','Empty','SPEAKING','');
insert into learning_videos(workspace_id,user_id,video_id,start_seconds,position_seconds) values('31000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','dQw4w9WgXcQ',0,0);
insert into learning_messages(user_id,workspace_id,role,content) values('30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','USER','I went home.');
insert into learning_speech(id,user_id,workspace_id,kind,status,storage_path) values
('32000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000002','RECORDING','READY','30000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000001/recording'),
('32000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000004','RECORDING','READY','30000000-0000-4000-8000-000000000001/32000000-0000-4000-8000-000000000002/recording');
insert into learning_ai_jobs(id,user_id,workspace_id,kind,status,input,attempts) values('36000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','31000000-0000-4000-8000-000000000006','WRITING_REPLY','FAILED','{}',1);
select is(learning_private.classify_workspace_kind(w),'LISTENING','Video workspace is listening') from learning_workspaces w where id='31000000-0000-4000-8000-000000000001';
select is(learning_private.classify_workspace_kind(w),'WRITING','Messages win over speech records') from learning_workspaces w where id='31000000-0000-4000-8000-000000000002';
select is(learning_private.classify_workspace_kind(w),'WRITING','A non-empty draft is writing') from learning_workspaces w where id='31000000-0000-4000-8000-000000000003';
select is(learning_private.classify_workspace_kind(w),'SPEAKING','Speech-only workspace is speaking') from learning_workspaces w where id='31000000-0000-4000-8000-000000000004';
select is(learning_private.classify_workspace_kind(w),'SPEAKING','Untouched speaking start is speaking') from learning_workspaces w where id='31000000-0000-4000-8000-000000000005';
select is(learning_private.classify_workspace_kind(w),'WRITING','Other empty workspaces are writing') from learning_workspaces w where id='31000000-0000-4000-8000-000000000006';
select throws_ok($$insert into learning_workspaces(id,user_id,title) values('31000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','No kind')$$,'23502',null,'Direct insert without kind fails');
select throws_ok($$insert into learning_workspaces(id,user_id,title,kind) values('31000000-0000-4000-8000-000000000009','30000000-0000-4000-8000-000000000001','Bad','READING')$$,'23514',null,'Unknown kind fails');
create temporary table kind_fixture(k text primary key,v jsonb);
grant all on kind_fixture to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','30000000-0000-4000-8000-000000000001',true);
-- Creation
select throws_ok($$select learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000001","workspaceId":"34000000-0000-4000-8000-000000000001","title":"No kind","prompt":""}')$$,'P0001','LEARNING_INVALID','CREATE requires kind');
select throws_ok($$select learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000001","workspaceId":"34000000-0000-4000-8000-000000000001","title":"Listen","prompt":"","kind":"LISTENING"}')$$,'P0001','LEARNING_INVALID','CREATE cannot make listening workspaces');
select is(learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000002","workspaceId":"34000000-0000-4000-8000-000000000002","title":"Speak","prompt":"","kind":"SPEAKING"}')->'workspace'->>'kind','SPEAKING','CREATE stores speaking');
select throws_ok($$select learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000002","workspaceId":"34000000-0000-4000-8000-000000000002","title":"Speak","prompt":"","kind":"WRITING"}')$$,'P0001','LEARNING_CONFLICT','Replay with another kind conflicts');
select is(learning_command('{"action":"CREATE","requestId":"33000000-0000-4000-8000-000000000003","workspaceId":"34000000-0000-4000-8000-000000000003","title":"Write","prompt":"","kind":"WRITING"}')->'workspace'->>'kind','WRITING','CREATE stores writing');
select is(learning_video_command('{"action":"VIDEO_ADD","requestId":"33000000-0000-4000-8000-000000000004","workspaceId":"34000000-0000-4000-8000-000000000004","videoId":"abcdefghijk","startSeconds":0,"title":"Clip"}')->'workspace'->>'kind','LISTENING','VIDEO_ADD creates listening');
-- Text commands
select throws_ok($$select learning_command('{"action":"SAVE_DRAFT","requestId":"33000000-0000-4000-8000-000000000010","workspaceId":"34000000-0000-4000-8000-000000000002","expectedVersion":0,"draft":"x"}')$$,'P0001','LEARNING_KIND','Speaking rejects drafts');
select lives_ok($$select learning_command('{"action":"SAVE_DRAFT","requestId":"33000000-0000-4000-8000-000000000011","workspaceId":"34000000-0000-4000-8000-000000000003","expectedVersion":0,"draft":"x"}')$$,'Writing accepts drafts');
select lives_ok($$select learning_command('{"action":"SAVE_DRAFT","requestId":"33000000-0000-4000-8000-000000000012","workspaceId":"34000000-0000-4000-8000-000000000004","expectedVersion":0,"draft":"x"}')$$,'Listening accepts drafts');
select throws_ok($$select learning_command('{"action":"RETRY","requestId":"33000000-0000-4000-8000-000000000013","jobId":"36000000-0000-4000-8000-000000000001"}')$$,'P0001','LEARNING_KIND','Speaking rejects writing job retry');
-- Speech commands
select throws_ok($$select learning_speech_command('{"action":"PROMPT","requestId":"33000000-0000-4000-8000-000000000020","id":"37000000-0000-4000-8000-000000000001","workspaceId":"34000000-0000-4000-8000-000000000003","level":"EASY","topic":""}')$$,'P0001','LEARNING_KIND','Writing rejects new prompts');
select lives_ok($$select learning_speech_command('{"action":"PROMPT","requestId":"33000000-0000-4000-8000-000000000021","id":"37000000-0000-4000-8000-000000000002","workspaceId":"34000000-0000-4000-8000-000000000002","level":"EASY","topic":""}')$$,'Speaking accepts prompts');
select throws_ok($$select begin_speech_upload('37000000-0000-4000-8000-000000000003','34000000-0000-4000-8000-000000000003',null,'','audio/webm',100,repeat('a',64))$$,'P0001','LEARNING_KIND','Writing rejects uploads');
select lives_ok($$select begin_speech_upload('37000000-0000-4000-8000-000000000004','34000000-0000-4000-8000-000000000002',null,'','audio/webm',100,repeat('a',64))$$,'Speaking accepts uploads');
select throws_ok($$select learning_speech_command('{"action":"EDIT","requestId":"33000000-0000-4000-8000-000000000022","id":"32000000-0000-4000-8000-000000000001","text":"edited"}')$$,'P0001','LEARNING_KIND','Writing legacy speech is not editable');
select throws_ok($$select learning_speech_command('{"action":"RETRY","requestId":"33000000-0000-4000-8000-000000000023","id":"32000000-0000-4000-8000-000000000001"}')$$,'P0001','LEARNING_KIND','Writing legacy speech cannot be retried');
select lives_ok($$select learning_speech_command('{"action":"KEEP","requestId":"33000000-0000-4000-8000-000000000024","id":"32000000-0000-4000-8000-000000000001","keep":true}')$$,'Writing legacy speech retention can change');
select lives_ok($$select learning_speech_command('{"action":"DELETE_AUDIO","requestId":"33000000-0000-4000-8000-000000000025","id":"32000000-0000-4000-8000-000000000001"}')$$,'Writing legacy audio can be deleted');
select lives_ok($$select learning_speech_command('{"action":"DELETE","requestId":"33000000-0000-4000-8000-000000000026","id":"32000000-0000-4000-8000-000000000002"}')$$,'Speech records in any workspace can be deleted');
insert into kind_fixture select 'writing_session',learning_command('{"action":"START","requestId":"33000000-0000-4000-8000-000000000030","workspaceId":"34000000-0000-4000-8000-000000000003","deviceId":"35000000-0000-4000-8000-000000000001","timezone":"UTC"}');
select throws_ok(format($$select learning_speech_command('{"action":"SPEECH_TICK","requestId":"33000000-0000-4000-8000-000000000031","sessionId":"%s","deviceId":"35000000-0000-4000-8000-000000000001","generation":1,"playing":true}')$$,(select v->'session'->>'id' from kind_fixture where k='writing_session')),'P0001','LEARNING_KIND','Writing rejects speech ticks');
-- Video commands
select throws_ok($$select learning_video_command('{"action":"VIDEO_NOTE","requestId":"33000000-0000-4000-8000-000000000040","workspaceId":"34000000-0000-4000-8000-000000000003"}')$$,'P0001','LEARNING_KIND','Writing rejects video commands');
reset role;
-- Immutability
select throws_ok($$update learning_workspaces set kind='SPEAKING' where id='34000000-0000-4000-8000-000000000003'$$,'P0001','LEARNING_KIND','Kind cannot change');
select lives_ok($$update learning_workspaces set title='Renamed' where id='34000000-0000-4000-8000-000000000003'$$,'Other columns still update');
select is((select kind from learning_workspaces where id='34000000-0000-4000-8000-000000000003'),'WRITING','Commands never change kind');
select * from finish();
rollback;
