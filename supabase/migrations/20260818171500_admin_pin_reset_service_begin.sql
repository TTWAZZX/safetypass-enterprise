begin;

create or replace function public.service_begin_admin_pin_reset(
  actor_id_param uuid,
  user_id_param uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user public.users%rowtype;
  security_row public.user_auth_security%rowtype;
  expiry_value timestamptz := now() + interval '30 minutes';
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if actor_id_param = user_id_param then
    raise exception 'Administrators cannot reset their own PIN here';
  end if;

  select * into target_user
  from public.users
  where id = user_id_param
  for update;
  if target_user.id is null then raise exception 'User not found'; end if;
  if target_user.role is distinct from 'USER' then raise exception 'Only USER accounts can be reset'; end if;
  if target_user.is_active is distinct from true then raise exception 'Inactive accounts cannot be reset'; end if;
  if not exists (
    select 1
    from auth.users au
    where au.id = target_user.id
      and au.email ~ '^[0-9]{13}@safetypass[.]com$'
      and target_user.national_id_fingerprint = encode(
        extensions.digest(split_part(lower(au.email), '@', 1), 'sha256'), 'hex'
      )
  ) then raise exception 'User Auth identity is not resettable'; end if;

  insert into public.user_auth_security(
    user_id, pin_version, failed_attempts, last_failed_at, locked_until,
    pin_reset_state, pin_reset_requested_at, pin_reset_expires_at, pin_reset_by
  ) values (
    target_user.id, 1, 0, null, null,
    'PENDING', now(), expiry_value, actor_id_param
  )
  on conflict (user_id) do update
  set failed_attempts = 0,
      last_failed_at = null,
      locked_until = null,
      pin_reset_state = 'PENDING',
      pin_reset_requested_at = now(),
      pin_reset_expires_at = expiry_value,
      pin_reset_by = actor_id_param,
      updated_at = now()
  returning * into security_row;

  return jsonb_build_object(
    'user_id', security_row.user_id,
    'reset_state', security_row.pin_reset_state,
    'expires_at', security_row.pin_reset_expires_at
  );
end;
$$;

revoke all on function public.service_begin_admin_pin_reset(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.service_begin_admin_pin_reset(uuid, uuid)
to service_role;

commit;
