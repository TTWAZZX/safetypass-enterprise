insert into public.users(
  id, national_id, name, role, pdpa_agreed, pdpa_agreed_at, is_active,
  national_id_hash, national_id_fingerprint
) values (
  '88888888-8888-4888-8888-888888888881',
  '1999999999999',
  'Orphaned Auth Repair User',
  'USER',
  true,
  now(),
  true,
  encode(extensions.digest('1999999999999', 'sha256'), 'hex'),
  encode(extensions.digest('1999999999999', 'sha256'), 'hex')
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-4888-8888-888888888882',
  'authenticated',
  'authenticated',
  '1999999999999@safetypass.com',
  'test-password-hash',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"password_scheme":"pin-v1"}',
  now(),
  now()
);

insert into public.exam_history(user_id, exam_type, score, total_questions, status)
values ('88888888-8888-4888-8888-888888888881', 'INDUCTION', 10, 10, 'PASSED');

insert into public.user_training_access(user_id, program_code)
values ('88888888-8888-4888-8888-888888888881', 'CONTRACTOR');

update public.user_auth_security
set pin_version = 1, failed_attempts = 3, locked_until = null
where user_id = '88888888-8888-4888-8888-888888888881';

do $$
begin
  if has_function_privilege('anon', 'public.repair_my_orphaned_registration()', 'EXECUTE') then
    raise exception 'Anonymous callers can execute orphan repair';
  end if;
  if not has_function_privilege('authenticated', 'public.repair_my_orphaned_registration()', 'EXECUTE') then
    raise exception 'Authenticated callers cannot execute orphan repair';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888882', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-4888-8888-888888888882","role":"authenticated"}',
  true
);
select public.repair_my_orphaned_registration();
reset role;

do $$
begin
  if exists (
    select 1 from public.users where id = '88888888-8888-4888-8888-888888888881'
  ) then raise exception 'Orphaned profile was not removed'; end if;

  if not exists (
    select 1 from public.users
    where id = '88888888-8888-4888-8888-888888888882'
      and name = 'Orphaned Auth Repair User'
      and pdpa_agreed = true
      and is_active = true
      and national_id_fingerprint = encode(extensions.digest('1999999999999', 'sha256'), 'hex')
  ) then raise exception 'Profile was not migrated to the replacement Auth identity'; end if;

  if not exists (
    select 1 from public.exam_history
    where user_id = '88888888-8888-4888-8888-888888888882'
  ) then raise exception 'Exam history was not preserved'; end if;

  if not exists (
    select 1 from public.user_training_access
    where user_id = '88888888-8888-4888-8888-888888888882'
      and program_code = 'CONTRACTOR'
  ) then raise exception 'Training access was not preserved'; end if;

  if not exists (
    select 1 from public.user_auth_security
    where user_id = '88888888-8888-4888-8888-888888888882'
      and pin_version = 1
      and failed_attempts = 3
  ) then raise exception 'Legacy PIN security state was not preserved'; end if;

  if not exists (
    select 1 from public.user_auth_profile_relinks
    where old_user_id = '88888888-8888-4888-8888-888888888881'
      and new_user_id = '88888888-8888-4888-8888-888888888882'
      and repair_reason = 'SELF_AUTHENTICATED_LEGACY_LOGIN'
  ) then raise exception 'Self-repair ledger was not recorded'; end if;

  if not exists (
    select 1 from public.audit_logs
    where action = 'LEGACY_AUTH_PROFILE_RELINKED'
      and details not like '%1999999999999%'
  ) then raise exception 'Redacted self-repair audit was not recorded'; end if;
end;
$$;
