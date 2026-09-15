-- 20260921000000_youtube_connections.sql ran `revoke all on schema private from
-- public, anon, authenticated` to lock down the new private.youtube_connections
-- table. `REVOKE ... ON SCHEMA` also strips schema-level USAGE, which the
-- pre-existing SECURITY INVOKER function create_initial_book_plan needs to
-- reference private.valid_timezone() by its schema-qualified name. Every book
-- plan creation has failed with "permission denied for schema private" since
-- that migration. This restores only the schema-level USAGE granted originally
-- in 20260913000000_core_domain.sql; the youtube_connections table-level
-- lockdown (and schema access for anon) is untouched.
grant usage on schema private to authenticated, service_role;
