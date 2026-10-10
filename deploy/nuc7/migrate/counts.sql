-- 이전과 백업이 지켜야 할 테이블마다 "schema.table,행 수,내용 해시" 한 줄.
-- 내용 해시는 앱 스키마에만 둔다. auth 테이블은 GoTrue 버전마다 열이 달라 행 수만 비교한다.
-- 시각 값의 글자는 세션 TimeZone에 따른다. Cloud와 nuc7 모두 UTC다(Task 3에서 확인).
select format('%s.%s,%s,%s', n.nspname, c.relname,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text,
  case when n.nspname in ('public', 'private', 'learning_private') then
    (xpath('/row/h/text()', query_to_xml(
      format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as h from %I.%I t', E'\n', '', n.nspname, c.relname),
      false, true, '')))[1]::text
  else '' end) as line
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p')
  and (n.nspname in ('public', 'private', 'learning_private')
       or (n.nspname, c.relname) in (('auth', 'users'), ('auth', 'identities'), ('storage', 'objects')))
order by 1;
