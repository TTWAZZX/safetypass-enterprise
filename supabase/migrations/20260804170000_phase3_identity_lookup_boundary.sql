begin;

-- Account-state lookup contains no profile fields, but allowing browsers to
-- call it directly still enables unrestricted national-ID enumeration. Route
-- all lookups through the rate-limited server API instead.
revoke all on function public.check_user_exists(text)
  from public, anon, authenticated;
grant execute on function public.check_user_exists(text)
  to service_role;

commit;
