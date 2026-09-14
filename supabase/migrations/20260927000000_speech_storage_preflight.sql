-- Storage evaluates INSERT permissions once before streaming bytes, with NULL metadata.
-- The committed object and explicit queue boundary must still match the upload binding.
create or replace function public.speech_storage_allowed(p_name text,p_metadata jsonb,p_write boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare j public.learning_speech;
begin
 select * into j from public.learning_speech where storage_path=p_name and user_id=auth.uid() for share;
 if not found or j.status='DELETED' or (not j.keep_audio and j.expires_at<=clock_timestamp()) or exists(select 1 from learning_private.speech_audio where id=j.id and deleting_at is not null) then return false; end if;
 if not p_write then return true; end if;
 return j.kind='RECORDING' and j.status='UPLOADING' and (p_metadata is null or (p_metadata->>'size'=j.file_size::text and p_metadata->>'mimetype'=j.mime_type));
end;
$$;
