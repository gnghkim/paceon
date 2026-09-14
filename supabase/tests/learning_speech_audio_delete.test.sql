begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
select has_column('public','learning_speech','audio_deleted_at','Audio removal is public metadata');
insert into auth.users(id,email) values('26000000-0000-4000-8000-000000000001','speech-audio-delete@example.test');
insert into learning_workspaces(id,user_id,title) values('26000000-0000-4000-8000-000000000002','26000000-0000-4000-8000-000000000001','Audio');
insert into learning_speech(id,user_id,workspace_id,kind,status,original_text,feedback,storage_path) values('26000000-0000-4000-8000-000000000003','26000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000002','RECORDING','READY','Original transcript','{"summary":"Preserved"}','26000000-0000-4000-8000-000000000001/26000000-0000-4000-8000-000000000003/recording');
insert into learning_private.speech_audio(id,storage_path) select id,storage_path from learning_speech where id='26000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','26000000-0000-4000-8000-000000000001',true);
select lives_ok($$select learning_speech_command(jsonb_build_object('action','DELETE_AUDIO','requestId',gen_random_uuid(),'id','26000000-0000-4000-8000-000000000003'))$$,'Owner can delete only audio');
select is((select original_text from learning_speech where id='26000000-0000-4000-8000-000000000003'),'Original transcript','Audio removal retains transcript');
select is((select status from learning_speech where id='26000000-0000-4000-8000-000000000003'),'READY','Audio removal retains ready status');
select throws_ok($$select speech_audio_path('26000000-0000-4000-8000-000000000003')$$,'P0001','LEARNING_NOT_FOUND','Reserved audio immediately unavailable');
reset role;
insert into learning_speech(id,user_id,workspace_id,kind,status,storage_path,expires_at,attempts,lease_token,lease_expires_at) values
('26000000-0000-4000-8000-000000000004','26000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000002','RECORDING','QUEUED','26000000-0000-4000-8000-000000000001/26000000-0000-4000-8000-000000000004/recording',clock_timestamp()-interval '1 day',0,null,null),
('26000000-0000-4000-8000-000000000005','26000000-0000-4000-8000-000000000001','26000000-0000-4000-8000-000000000002','RECORDING','RUNNING','26000000-0000-4000-8000-000000000001/26000000-0000-4000-8000-000000000005/recording',clock_timestamp()-interval '1 day',1,'26000000-0000-4000-8000-000000000006',clock_timestamp()+interval '1 minute');
insert into learning_private.speech_audio(id,storage_path) select id,storage_path from learning_speech where id in ('26000000-0000-4000-8000-000000000004','26000000-0000-4000-8000-000000000005');
set local role service_role;
select speech_cleanup_candidates();
select is((select status from learning_speech where id='26000000-0000-4000-8000-000000000004'),'FAILED','Queued audio expires even while AI is disabled');
select is((select error_code from learning_speech where id='26000000-0000-4000-8000-000000000005'),'AUDIO_EXPIRED','Running audio expiration revokes processing');
select is(finish_speech_job('26000000-0000-4000-8000-000000000005','26000000-0000-4000-8000-000000000006',null,'PROVIDER_ERROR'),false,'Expired audio worker cannot complete its former lease');
reset role;
select * from finish();
rollback;
