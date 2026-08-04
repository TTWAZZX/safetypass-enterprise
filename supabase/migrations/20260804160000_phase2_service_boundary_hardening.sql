begin;

-- The submission email endpoint is public, but its queue access is not. Only
-- the server-side API may read recipient addresses or mutate delivery state.
revoke all on function public.get_external_registration_email_batch(text, text)
  from public, anon, authenticated;
grant execute on function public.get_external_registration_email_batch(text, text)
  to service_role;

revoke all on function public.record_external_registration_email_result(uuid, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.record_external_registration_email_result(uuid, text, boolean, text)
  to service_role;

-- Superseded by add_my_supplier_outsource_access(), which additionally checks
-- active-account state and validates the dedicated program fields.
revoke all on function public.add_my_training_access(text[], text, text)
  from public, anon, authenticated;
grant execute on function public.add_my_training_access(text[], text, text)
  to service_role;

-- These object privileges bypass row-level intent and are not required by the
-- browser application. DML remains unchanged for compatibility and is still
-- constrained by the existing RLS policies and protected-field trigger.
revoke truncate, references, trigger on all tables in schema public
  from anon, authenticated;

-- Objects created by repository migrations run as postgres and must remain
-- private until a migration grants the exact privileges they require.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

commit;
