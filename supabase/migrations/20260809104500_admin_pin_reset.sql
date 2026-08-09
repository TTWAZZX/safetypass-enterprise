begin;

alter table public.user_auth_security
  add column if not exists pin_reset_state text not null default 'NONE'
    check (pin_reset_state in ('NONE', 'PENDING', 'ACTIVE')),
  add column if not exists pin_reset_requested_at timestamptz,
  add column if not exists pin_reset_expires_at timestamptz,
  add column if not exists pin_reset_by uuid references public.users(id) on delete set null;

create or replace function public.get_auth_login_context(national_id_param text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_exists', true,
    'user_id', u.id,
    'is_active', coalesce(u.is_active, false),
    'pin_version', coalesce(s.pin_version, 1),
    'locked_until', s.locked_until,
    'pin_reset_state', coalesce(s.pin_reset_state, 'NONE'),
    'pin_reset_expires_at', s.pin_reset_expires_at
  )
  from public.users u
  left join public.user_auth_security s on s.user_id = u.id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by exists (select 1 from auth.users au where au.id = u.id) desc,
           coalesce(u.pdpa_agreed, false) desc,
           u.created_at desc
  limit 1
$$;
revoke all on function public.get_auth_login_context(text) from public, anon, authenticated;
grant execute on function public.get_auth_login_context(text) to service_role;

create or replace function public.admin_begin_pin_reset(user_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user public.users%rowtype;
  expiry_value timestamptz := now() + interval '30 minutes';
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if user_id_param = auth.uid() then raise exception 'Administrators cannot reset their own PIN here'; end if;

  select * into target_user from public.users where id = user_id_param for update;
  if target_user.id is null then raise exception 'User not found'; end if;
  if target_user.role is distinct from 'USER' then raise exception 'Only USER accounts can be reset'; end if;
  if target_user.is_active is distinct from true then raise exception 'Inactive accounts cannot be reset'; end if;

  insert into public.user_auth_security(
    user_id, pin_version, failed_attempts, last_failed_at, locked_until,
    pin_reset_state, pin_reset_requested_at, pin_reset_expires_at, pin_reset_by
  ) values (
    target_user.id, 2, 0, null, null,
    'PENDING', now(), expiry_value, auth.uid()
  )
  on conflict (user_id) do update
  set failed_attempts = 0,
      last_failed_at = null,
      locked_until = null,
      pin_reset_state = 'PENDING',
      pin_reset_requested_at = now(),
      pin_reset_expires_at = expiry_value,
      pin_reset_by = auth.uid(),
      updated_at = now();

  return jsonb_build_object(
    'user_id', target_user.id,
    'reset_state', 'PENDING',
    'expires_at', expiry_value
  );
end;
$$;
revoke all on function public.admin_begin_pin_reset(uuid) from public, anon;
grant execute on function public.admin_begin_pin_reset(uuid) to authenticated, service_role;

create or replace function public.admin_activate_pin_reset(user_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  security_row public.user_auth_security%rowtype;
  admin_email_value text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  update public.user_auth_security
  set pin_reset_state = 'ACTIVE', updated_at = now()
  where user_id = user_id_param
    and pin_reset_state = 'PENDING'
    and pin_reset_by = auth.uid()
    and pin_reset_expires_at > now()
  returning * into security_row;
  if security_row.user_id is null then raise exception 'PIN reset is not pending'; end if;

  select coalesce(au.email, auth.uid()::text) into admin_email_value
  from auth.users au where au.id = auth.uid();

  insert into public.audit_logs(admin_email, action, target, details)
  values (
    coalesce(admin_email_value, auth.uid()::text),
    'ADMIN_PIN_RESET',
    'users:' || user_id_param::text,
    jsonb_build_object(
      'temporary_pin_source', 'NATIONAL_ID_LAST_6',
      'expires_at', security_row.pin_reset_expires_at,
      'pin_value_recorded', false
    )::text
  );

  return jsonb_build_object(
    'user_id', security_row.user_id,
    'reset_state', security_row.pin_reset_state,
    'expires_at', security_row.pin_reset_expires_at
  );
end;
$$;
revoke all on function public.admin_activate_pin_reset(uuid) from public, anon;
grant execute on function public.admin_activate_pin_reset(uuid) to authenticated, service_role;

create or replace function public.complete_auth_pin_change(
  user_id_param uuid,
  national_id_param text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid identity'; end if;
  if not exists (
    select 1 from public.users u
    where u.id = user_id_param
      and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  ) then raise exception 'Identity mismatch'; end if;

  update public.user_auth_security
  set failed_attempts = 0,
      last_failed_at = null,
      locked_until = null,
      pin_version = 2,
      pin_changed_at = now(),
      pin_reset_state = 'NONE',
      pin_reset_requested_at = null,
      pin_reset_expires_at = null,
      pin_reset_by = null,
      updated_at = now()
  where user_id = user_id_param;
  if not found then raise exception 'Authentication security state not found'; end if;
end;
$$;
revoke all on function public.complete_auth_pin_change(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_auth_pin_change(uuid, text) to service_role;

commit;
