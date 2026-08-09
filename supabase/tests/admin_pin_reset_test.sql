do $$
begin
  if has_function_privilege('anon', 'public.admin_begin_pin_reset(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_activate_pin_reset(uuid)', 'EXECUTE') then
    raise exception 'Anonymous callers can invoke an admin PIN reset function';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_begin_pin_reset(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_activate_pin_reset(uuid)', 'EXECUTE') then
    raise exception 'Authenticated admin PIN reset grants are missing';
  end if;
  if has_function_privilege('authenticated', 'public.complete_auth_pin_change(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_auth_pin_change(uuid, text)', 'EXECUTE') then
    raise exception 'PIN completion function is not restricted to service_role';
  end if;
  if exists (
    select 1 from public.user_auth_security
    where pin_reset_state <> 'NONE'
       or pin_reset_requested_at is not null
       or pin_reset_expires_at is not null
       or pin_reset_by is not null
  ) then raise exception 'Migration changed existing authentication reset state'; end if;
end;
$$;

insert into public.users(
  id, national_id, name, role, pdpa_agreed, is_active,
  national_id_hash, national_id_fingerprint
) values
  ('a9000000-0000-4000-8000-000000000001', '1888888888811', 'PIN Reset Test Admin', 'ADMIN', true, true,
   encode(extensions.digest('1888888888811', 'sha256'), 'hex'), encode(extensions.digest('1888888888811', 'sha256'), 'hex')),
  ('a9000000-0000-4000-8000-000000000002', '1888888888812', 'PIN Reset Test User', 'USER', true, true,
   encode(extensions.digest('1888888888812', 'sha256'), 'hex'), encode(extensions.digest('1888888888812', 'sha256'), 'hex'));

update public.user_auth_security
set pin_version = 2, failed_attempts = 4, locked_until = now() + interval '15 minutes'
where user_id = 'a9000000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.admin_begin_pin_reset('a9000000-0000-4000-8000-000000000002');
reset role;

do $$
begin
  if not exists (
    select 1 from public.user_auth_security
    where user_id = 'a9000000-0000-4000-8000-000000000002'
      and pin_version = 2
      and pin_reset_state = 'PENDING'
      and pin_reset_by = 'a9000000-0000-4000-8000-000000000001'
      and pin_reset_expires_at between now() + interval '29 minutes' and now() + interval '31 minutes'
      and failed_attempts = 0
      and locked_until is null
  ) then raise exception 'Admin PIN reset was not prepared without downgrading PIN v2'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a9000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.admin_activate_pin_reset('a9000000-0000-4000-8000-000000000002');
reset role;

do $$
declare
  login_context jsonb;
begin
  select public.get_auth_login_context('1888888888812') into login_context;
  if login_context->>'pin_reset_state' <> 'ACTIVE'
     or login_context->>'pin_version' <> '2'
     or login_context->>'pin_reset_expires_at' is null then
    raise exception 'Login context does not expose the active reset state';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_PIN_RESET'
      and target = 'users:a9000000-0000-4000-8000-000000000002'
      and details not like '%1888888888812%'
      and details not like '%888812%'
  ) then raise exception 'PIN reset audit is missing or exposes PIN/identity data'; end if;
end;
$$;

set local role service_role;
select public.complete_auth_pin_change(
  'a9000000-0000-4000-8000-000000000002',
  '1888888888812'
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.user_auth_security
    where user_id = 'a9000000-0000-4000-8000-000000000002'
      and pin_version = 2
      and pin_reset_state = 'NONE'
      and pin_reset_requested_at is null
      and pin_reset_expires_at is null
      and pin_reset_by is null
      and pin_changed_at is not null
  ) then raise exception 'Setting a permanent PIN did not clear reset state'; end if;
end;
$$;
