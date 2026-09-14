-- Reject empty source summaries before job quota admission.
create or replace function learning_private.video_input(p_workspace uuid,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
declare v public.learning_videos; notes jsonb; excerpt text; total bigint; evidence text; whitespace text;
begin
 select * into v from public.learning_videos where workspace_id=p_workspace;
 if not found then return p_input; end if;
 excerpt:=substring(v.transcript from v.context_start+1 for v.context_end-v.context_start);
 select coalesce(jsonb_agg(jsonb_build_object('positionSeconds',position_seconds,'content',content) order by created_at,id),'[]'::jsonb)
 into notes from (select * from public.learning_video_notes where workspace_id=p_workspace order by created_at desc,id desc limit 20) n;
 select length(coalesce(p_input->>'prompt',''))+length(excerpt)
  +coalesce((select sum(length(x->>'content')) from jsonb_array_elements(p_input->'messages') x),0)
  +coalesce((select sum(length(x->>'content')) from jsonb_array_elements(notes) x),0) into total;
 if total>20000 then raise exception 'LEARNING_LIMIT'; end if;
 -- Match Python str.strip whitespace, independently of PostgreSQL database locale.
 -- Source-only summaries must contain evidence before queue admission or cached reuse.
 if p_input->>'kind'='STUDY_SUMMARY' and not exists(select 1 from jsonb_array_elements(p_input->'messages') x where x->>'role'='USER') then
  select string_agg(chr(c),'') into whitespace from unnest(array[9,10,11,12,13,28,29,30,31,32,133,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288]) c;
  select excerpt||coalesce(string_agg(x->>'content',''),'') into evidence from jsonb_array_elements(notes) x;
  if length(translate(evidence,whitespace,''))=0 then raise exception 'LEARNING_INVALID'; end if;
 end if;
 return p_input||jsonb_build_object('source',jsonb_build_object('type','YOUTUBE','videoId',v.video_id,'transcript',excerpt,'notes',notes));
end;
$$;


revoke all on function learning_private.video_input(uuid,jsonb) from public,anon,authenticated;
