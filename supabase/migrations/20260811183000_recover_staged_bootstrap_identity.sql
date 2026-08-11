begin;

-- Resolve an interrupted registration Auth identity without exposing auth.users
-- to the browser. Only identities that still belong to an unfinished
-- registration and still use the random bootstrap credential are recoverable.
create or replace function public.get_staged_auth_bootstrap_identity(search_id text)
returns table(user_id uuid, recoverable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with registration_state as (
    select
      count(*) filter (where coalesce(u.pdpa_agreed, false)) as completed_count,
      count(*) filter (
        where not coalesce(u.pdpa_agreed, false)
          and coalesce(u.is_active, false)
      ) as staged_count
    from public.users u
    where search_id ~ '^[0-9]{13}$'
      and u.national_id_fingerprint = encode(extensions.digest(search_id, 'sha256'), 'hex')
  )
  select
    au.id,
    (
      state.completed_count = 0
      and (
        state.staged_count > 0
        or not exists (
          select 1
          from public.users u
          where u.national_id_fingerprint = encode(extensions.digest(search_id, 'sha256'), 'hex')
        )
      )
      and coalesce(au.raw_user_meta_data ->> 'password_scheme', '') = 'bootstrap-v2'
    ) as recoverable
  from auth.users au
  cross join registration_state state
  where search_id ~ '^[0-9]{13}$'
    and lower(au.email) = lower(search_id || '@safetypass.com')
  limit 1
$$;

revoke all on function public.get_staged_auth_bootstrap_identity(text)
from public, anon, authenticated;
grant execute on function public.get_staged_auth_bootstrap_identity(text)
to service_role;

commit;
