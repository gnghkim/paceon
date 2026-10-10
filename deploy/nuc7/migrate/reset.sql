-- 리허설로 넣은 데이터를 비운다. restore.sh --reset만 쓴다. 전환 뒤에는 절대 쓰지 않는다.
do $$
declare app_tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into app_tables
    from pg_tables
   where schemaname in ('public', 'private', 'learning_private');
  execute 'truncate ' || app_tables || ', auth.users, auth.identities, storage.objects restart identity cascade';
end $$;
