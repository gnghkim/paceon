-- Retention must run independently of provider availability and job completion.
create or replace function public.speech_cleanup_candidates() returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.learning_speech; result jsonb;
begin
 for j in select s.* from public.learning_speech s join learning_private.speech_audio a on a.id=s.id where a.deleting_at is null and (status='DELETED' or (not keep_audio and (expires_at<=clock_timestamp() or (status='UPLOADING' and created_at<clock_timestamp()-interval '1 hour')))) order by s.created_at for update of s skip locked limit 100 loop
  update learning_private.speech_audio set deleting_at=clock_timestamp() where id=j.id;
  update public.learning_speech set
   status=case when status in ('UPLOADING','QUEUED','RUNNING') then 'FAILED' else status end,
   error_code=case when status in ('UPLOADING','QUEUED','RUNNING') then case when expires_at<=clock_timestamp() then 'AUDIO_EXPIRED' else 'UPLOAD_EXPIRED' end else error_code end,
   lease_token=null,lease_expires_at=null,audio_deleted_at=coalesce(audio_deleted_at,clock_timestamp()),updated_at=clock_timestamp() where id=j.id;
 end loop;
 update learning_private.speech_audio set deleting_at=clock_timestamp() where id in (select a.id from learning_private.speech_audio a where deleting_at is null and not exists(select 1 from public.learning_speech s where s.id=a.id) limit 100);
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'storage_path',storage_path)),'[]') into result from
 (select a.id,a.storage_path from learning_private.speech_audio a where deleting_at is not null and (cleaned_at is null or exists(select 1 from storage.objects o where o.bucket_id='learning-audio' and o.name=a.storage_path)) order by deleting_at limit 100) c;
 return result;
end;
$$;
