-- Private, immutable PDF uploads and a durable parser queue.
create function private.valid_pdf_result(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare item jsonb; warning jsonb; page_count numeric; next_page integer := 1; first_page numeric; last_page numeric;
begin
 if v is null or jsonb_typeof(v) is distinct from 'object' or octet_length(v::text)>2000000 then return false; end if;
 if not(v ?& array['pageCount','title','units','textExcerpt','analysisOutline','warnings'])
  or v-array['pageCount','title','units','textExcerpt','analysisOutline','warnings']<>'{}'::jsonb then return false; end if;
 if jsonb_typeof(v->'pageCount') is distinct from 'number' then return false; end if;
 page_count := (v->>'pageCount')::numeric;
 if page_count<>trunc(page_count) or page_count not between 1 and 500 then return false; end if;
 if jsonb_typeof(v->'title') is distinct from 'string' or length(btrim(v->>'title')) not between 1 and 500
  or jsonb_typeof(v->'textExcerpt') is distinct from 'string' or length(v->>'textExcerpt')>12000
  or jsonb_typeof(v->'analysisOutline') is distinct from 'string' or length(v->>'analysisOutline')>12000
  or jsonb_typeof(v->'units') is distinct from 'array' or jsonb_typeof(v->'warnings') is distinct from 'array' then return false; end if;
 if jsonb_array_length(v->'units') not between 1 and 500 or jsonb_array_length(v->'warnings')>4 then return false; end if;
 for warning in select value from jsonb_array_elements(v->'warnings') loop
  if jsonb_typeof(warning) is distinct from 'string' or warning#>>'{}' not in ('NO_TEXT','NO_OUTLINE','TRUNCATED_TEXT','INVALID_OUTLINE') then return false; end if;
 end loop;
 for item in select value from jsonb_array_elements(v->'units') loop
  if jsonb_typeof(item) is distinct from 'object' then return false; end if;
  if not(item ?& array['title','startPage','endPage']) or item-array['title','startPage','endPage']<>'{}'::jsonb
   or jsonb_typeof(item->'title') is distinct from 'string' or length(btrim(item->>'title')) not between 1 and 500
   or jsonb_typeof(item->'startPage') is distinct from 'number' or jsonb_typeof(item->'endPage') is distinct from 'number' then return false; end if;
  first_page := (item->>'startPage')::numeric; last_page := (item->>'endPage')::numeric;
  if first_page<>trunc(first_page) or last_page<>trunc(last_page) or first_page<>next_page or last_page<first_page or last_page>page_count then return false; end if;
  next_page := last_page::integer+1;
 end loop;
 return next_page=page_count+1;
exception when others then return false;
end; $$;
revoke all on function private.valid_pdf_result(jsonb) from public,anon,authenticated;
grant execute on function private.valid_pdf_result(jsonb) to service_role;

create table public.pdf_imports (
 id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 filename text not null check(length(btrim(filename)) between 1 and 200 and filename !~ '[[:cntrl:]/\\]'),
 storage_path text not null unique,
 file_size integer not null check(file_size between 5 and 10485760),
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null default 'UPLOADING' check(status in ('UPLOADING','PENDING','PROCESSING','READY','FAILED','IMPORTED')),
 result jsonb, error_code text check(error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
 attempts integer not null default 0 check(attempts between 0 and 3),
 lease_token uuid, lease_expires_at timestamptz,
 resource_id uuid,
 -- Preserve the original confirmation payload even if the resulting resource is edited.
 confirmation_title text, confirmation_current_page integer,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(resource_id,user_id) references public.resources(id,user_id) on delete cascade,
 check(storage_path=user_id::text||'/'||id::text||'.pdf'),
 check((status='PROCESSING' and lease_token is not null and lease_expires_at is not null) or (status<>'PROCESSING' and lease_token is null and lease_expires_at is null)),
 check((status in ('READY','IMPORTED'))=(result is not null)),
 check((status='FAILED')=(error_code is not null)),
 check((status='IMPORTED' and resource_id is not null and confirmation_title is not null and confirmation_current_page is not null)
  or (status<>'IMPORTED' and resource_id is null and confirmation_title is null and confirmation_current_page is null))
);
create index pdf_imports_owner_recent on public.pdf_imports(user_id,created_at desc);
create index pdf_imports_claim on public.pdf_imports(created_at,id) where status in ('PENDING','PROCESSING');
create trigger touch_updated_at before update on public.pdf_imports for each row execute function private.touch_updated_at();
alter table public.pdf_imports enable row level security;
revoke all on public.pdf_imports from public,anon,authenticated;
grant select on public.pdf_imports to authenticated;
grant all on public.pdf_imports to service_role;
create policy pdf_imports_owner_read on public.pdf_imports for select to authenticated using((select auth.uid())=user_id);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('learning-pdfs','learning-pdfs',false,10485760,array['application/pdf']);
create policy pdf_owner_select on storage.objects for select to authenticated
 using(bucket_id='learning-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy pdf_owner_insert on storage.objects for insert to authenticated
 with check(bucket_id='learning-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text
  and exists(select 1 from public.pdf_imports i where i.user_id=(select auth.uid()) and i.storage_path=name and i.status='UPLOADING'));
-- Deletion is through the Storage API; no SQL cleanup of real object metadata.
create policy pdf_owner_delete on storage.objects for delete to authenticated
 using(bucket_id='learning-pdfs' and (storage.foldername(name))[1]=(select auth.uid())::text);

create function public.begin_pdf_import(p_id uuid,p_filename text,p_file_size integer,p_content_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); job public.pdf_imports;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_id is null or p_filename is null or length(btrim(p_filename)) not between 1 and 200 or p_filename ~ '[[:cntrl:]/\\]'
  or p_file_size is null or p_file_size not between 5 and 10485760 or p_content_sha256 is null or p_content_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid PDF upload' using errcode='23514'; end if;
 -- Serialize the same retry key, including collisions from different owners.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,71));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,7));
 select * into job from public.pdf_imports where id=p_id for update;
 if found then
  if job.user_id<>owner_id then raise exception 'Import not found' using errcode='42501'; end if;
  if (job.filename,job.file_size,job.content_sha256) is distinct from (p_filename,p_file_size,p_content_sha256) then raise exception 'Import retry differs' using errcode='40001'; end if;
  return to_jsonb(job);
 end if;
 if (select count(*) from public.pdf_imports where user_id=owner_id and status in ('UPLOADING','PENDING','PROCESSING'))>=5 then raise exception 'PDF queue full' using errcode='PT429'; end if;
 insert into public.pdf_imports(id,user_id,filename,storage_path,file_size,content_sha256)
  values(p_id,owner_id,p_filename,owner_id::text||'/'||p_id::text||'.pdf',p_file_size,p_content_sha256) returning * into job;
 return to_jsonb(job);
end; $$;

create function public.queue_pdf_import(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.pdf_imports;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into job from public.pdf_imports where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Import not found' using errcode='42501'; end if;
 if job.status<>'UPLOADING' then return to_jsonb(job); end if;
 if not exists(select 1 from storage.objects where bucket_id='learning-pdfs' and name=job.storage_path
  and metadata->>'size'=job.file_size::text) then raise exception 'PDF object missing or invalid' using errcode='PT409'; end if;
 update public.pdf_imports set status='PENDING' where id=job.id returning * into job;
 return to_jsonb(job);
end; $$;

create function public.retry_pdf_import(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); job public.pdf_imports;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text,7));
 select * into job from public.pdf_imports where id=p_id and user_id=owner_id for update;
 if not found then raise exception 'Import not found' using errcode='42501'; end if;
 if job.status<>'FAILED' then raise exception 'Import is not failed' using errcode='PT409'; end if;
 if not exists(select 1 from storage.objects where bucket_id='learning-pdfs' and name=job.storage_path and metadata->>'size'=job.file_size::text) then raise exception 'PDF object missing or invalid' using errcode='PT409'; end if;
 if (select count(*) from public.pdf_imports where user_id=owner_id and status in ('UPLOADING','PENDING','PROCESSING'))>=5 then raise exception 'PDF queue full' using errcode='PT429'; end if;
 update public.pdf_imports set status='PENDING',attempts=0,error_code=null where id=job.id returning * into job;
 return to_jsonb(job);
end; $$;

create function public.discard_pdf_import(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare job public.pdf_imports;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into job from public.pdf_imports where id=p_id and user_id=auth.uid() for update;
 if not found then return false; end if;
 if job.status in ('IMPORTED','PROCESSING') then raise exception 'Import cannot be discarded' using errcode='PT409'; end if;
 delete from public.pdf_imports where id=job.id;
 return true;
end; $$;

create function public.claim_pdf_import() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare job public.pdf_imports;
begin
 loop
  select * into job from public.pdf_imports where status='PENDING' or (status='PROCESSING' and lease_expires_at<=clock_timestamp()) order by created_at,id for update skip locked limit 1;
  if not found then return null; end if;
  if job.attempts>=3 then
   update public.pdf_imports set status='FAILED',error_code='WORKER_TIMEOUT',lease_token=null,lease_expires_at=null where id=job.id;
   continue;
  end if;
  update public.pdf_imports set status='PROCESSING',attempts=attempts+1,lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '120 seconds' where id=job.id returning * into job;
  return to_jsonb(job);
 end loop;
end; $$;

create function public.finish_pdf_import(p_id uuid,p_lease_token uuid,p_result jsonb,p_error_code text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job public.pdf_imports;
begin
 select * into job from public.pdf_imports where id=p_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>clock_timestamp() for update;
 if not found then return false; end if;
 if p_error_code is null then
  if not private.valid_pdf_result(p_result) then raise exception 'Invalid PDF result' using errcode='23514'; end if;
 elsif p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$' then raise exception 'Invalid PDF error' using errcode='23514'; end if;
 update public.pdf_imports set status=case when p_error_code is null then 'READY' else 'FAILED' end,
  result=case when p_error_code is null then p_result end,error_code=p_error_code,lease_token=null,lease_expires_at=null where id=job.id;
 return true;
end; $$;

create function public.confirm_pdf_import(p_id uuid,p_title text,p_current_page integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); job public.pdf_imports; new_resource_id uuid; item jsonb; unit_sequence integer := 0; page_count integer;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into job from public.pdf_imports where id=p_id and user_id=owner_id for update;
 if not found then raise exception 'Import not found' using errcode='42501'; end if;
 if job.status='IMPORTED' then
  if (job.confirmation_title,job.confirmation_current_page) is distinct from (p_title,p_current_page) then raise exception 'Import confirmation differs' using errcode='PT409'; end if;
  return job.resource_id;
 end if;
 if job.status<>'READY' then raise exception 'Import is not ready' using errcode='PT409'; end if;
 if not private.valid_pdf_result(job.result) then raise exception 'Invalid PDF result' using errcode='23514'; end if;
 page_count := (job.result->>'pageCount')::numeric::integer;
 if p_title is null or length(btrim(p_title)) not between 1 and 500 or p_current_page is null or p_current_page not between 0 and page_count then raise exception 'Invalid PDF confirmation' using errcode='23514'; end if;
 insert into public.resources(user_id,title,type,workload_unit,source,source_id,total_pages,total_units,initial_completed_workload,status)
  values(owner_id,p_title,'BOOK','PAGE','PDF_IMPORT',job.id::text,page_count,jsonb_array_length(job.result->'units'),p_current_page,
   case when p_current_page=page_count then 'COMPLETED'::public.resource_status else 'ACTIVE'::public.resource_status end) returning id into new_resource_id;
 for item in select value from jsonb_array_elements(job.result->'units') loop
  unit_sequence := unit_sequence+1;
  insert into public.resource_units(user_id,resource_id,title,sequence,unit_type,start_page,end_page,workload)
   values(owner_id,new_resource_id,item->>'title',unit_sequence,'SECTION',(item->>'startPage')::numeric::integer,(item->>'endPage')::numeric::integer,
    (item->>'endPage')::numeric-(item->>'startPage')::numeric+1);
 end loop;
 update public.pdf_imports set status='IMPORTED',resource_id=new_resource_id,confirmation_title=p_title,confirmation_current_page=p_current_page where id=job.id;
 return new_resource_id;
end; $$;

revoke all on function public.begin_pdf_import(uuid,text,integer,text),public.queue_pdf_import(uuid),public.retry_pdf_import(uuid),public.discard_pdf_import(uuid),public.confirm_pdf_import(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.begin_pdf_import(uuid,text,integer,text),public.queue_pdf_import(uuid),public.retry_pdf_import(uuid),public.discard_pdf_import(uuid),public.confirm_pdf_import(uuid,text,integer) to authenticated;
revoke all on function public.claim_pdf_import(),public.finish_pdf_import(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_pdf_import(),public.finish_pdf_import(uuid,uuid,jsonb,text) to service_role;
