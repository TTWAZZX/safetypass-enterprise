begin;

insert into public.users(
  id, national_id, name, role, pdpa_agreed, pdpa_agreed_at, is_active,
  national_id_hash, national_id_fingerprint
) values
(
  'a1800000-0000-4000-8000-000000000001', '1999999999701',
  'Auth Relink Admin', 'ADMIN', true, now(), true,
  encode(extensions.digest('1999999999701', 'sha256'), 'hex'),
  encode(extensions.digest('1999999999701', 'sha256'), 'hex')
),
(
  'a1800000-0000-4000-8000-000000000002', '1999999999702',
  'Auth Relink Target', 'USER', true, now(), true,
  encode(extensions.digest('1999999999702', 'sha256'), 'hex'),
  encode(extensions.digest('1999999999702', 'sha256'), 'hex')
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
(
  '00000000-0000-0000-0000-000000000000',
  'a1800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  '1999999999701@safetypass.com', 'test-password-hash', now(),
  '{"provider":"email","providers":["email"]}', '{"password_scheme":"pin-v2"}', now(), now()
),
(
  '00000000-0000-0000-0000-000000000000',
  'a1800000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
  '1999999999702@safetypass.com', 'test-password-hash', now(),
  '{"provider":"email","providers":["email"]}', '{"password_scheme":"pin-v1"}', now(), now()
);

insert into public.exam_history(id, user_id, exam_type, score, total_questions, status)
values ('a1800000-0000-4000-8000-000000000010', 'a1800000-0000-4000-8000-000000000002', 'SUPPLIER_OUTSOURCE', 20, 20, 'PASSED');
insert into public.exam_logs(user_id, exam_type, score, passed)
values ('a1800000-0000-4000-8000-000000000002', 'SUPPLIER_OUTSOURCE', 20, true);
insert into public.work_permits(id, user_id, permit_no, expire_date, status)
values ('a1800000-0000-4000-8000-000000000011', 'a1800000-0000-4000-8000-000000000002', 'AUTH-RELINK-WP', now() + interval '1 day', 'ACTIVE');
insert into public.user_training_access(user_id, program_code, participant_type, work_type)
values ('a1800000-0000-4000-8000-000000000002', 'SUPPLIER_OUTSOURCE', 'supplier', 'Driver');
insert into public.supplier_outsource_passes(id, user_id, exam_history_id, expires_at)
values (
  'a1800000-0000-4000-8000-000000000012',
  'a1800000-0000-4000-8000-000000000002',
  'a1800000-0000-4000-8000-000000000010',
  now() + interval '1 year'
);
update public.user_auth_security
set pin_version = 1, failed_attempts = 2
where user_id = 'a1800000-0000-4000-8000-000000000002';
insert into public.admin_identity_access_attempts(actor_user_id, target_user_id, operation)
values ('a1800000-0000-4000-8000-000000000001', 'a1800000-0000-4000-8000-000000000002', 'REVEAL');
insert into public.admin_identity_operations(
  target_user_id, actor_user_id, old_fingerprint, new_fingerprint,
  old_masked_id, new_masked_id, reason
) values (
  'a1800000-0000-4000-8000-000000000002',
  'a1800000-0000-4000-8000-000000000001',
  repeat('1', 64), repeat('2', 64), '199••••••9702', '199••••••9703',
  'Pending fixture operation'
);

set local role service_role;
select public.service_relink_orphaned_profile_for_pin_reset(
  'a1800000-0000-4000-8000-000000000001',
  'a1800000-0000-4000-8000-000000000002'
);
reset role;

do $$
declare
  canonical_id constant uuid := 'a1800000-0000-4000-8000-000000000003';
  source_id constant uuid := 'a1800000-0000-4000-8000-000000000002';
begin
  if exists (select 1 from public.users where id = source_id) then
    raise exception 'Orphaned profile was not removed';
  end if;
  if not exists (
    select 1 from public.users u join auth.users au on au.id = u.id
    where u.id = canonical_id and u.name = 'Auth Relink Target'
  ) then raise exception 'Profile was not relinked to the Auth UUID'; end if;
  if exists (
    select 1 from public.exam_history where user_id = source_id
    union all select 1 from public.exam_logs where user_id = source_id
    union all select 1 from public.work_permits where user_id = source_id
    union all select 1 from public.user_training_access where user_id = source_id
    union all select 1 from public.supplier_outsource_passes where user_id = source_id
    union all select 1 from public.user_auth_security where user_id = source_id
    union all select 1 from public.admin_identity_access_attempts where target_user_id = source_id
    union all select 1 from public.admin_identity_operations where target_user_id = source_id
  ) then raise exception 'A protected dependency still references the old UUID'; end if;
  if (select count(*) from public.exam_history where user_id = canonical_id) <> 1
     or (select count(*) from public.exam_logs where user_id = canonical_id) <> 1
     or (select count(*) from public.work_permits where user_id = canonical_id) <> 1
     or (select count(*) from public.user_training_access where user_id = canonical_id) <> 1
     or (select count(*) from public.supplier_outsource_passes where user_id = canonical_id) <> 1
     or (select count(*) from public.user_auth_security where user_id = canonical_id) <> 1
     or (select count(*) from public.admin_identity_access_attempts where target_user_id = canonical_id) <> 1
     or (select count(*) from public.admin_identity_operations where target_user_id = canonical_id) <> 1 then
    raise exception 'Protected dependencies were not preserved';
  end if;
  if not exists (
    select 1 from public.user_auth_profile_relinks
    where old_user_id = source_id and new_user_id = canonical_id
  ) then raise exception 'Idempotent relink ledger was not recorded'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_AUTH_PROFILE_RELINKED'
      and target = 'users:' || canonical_id::text
      and details not like '%1999999999702%'
  ) then raise exception 'Redacted relink audit event was not recorded'; end if;
end;
$$;

update auth.users
set raw_user_meta_data = jsonb_build_object('password_scheme', 'pin-v2-admin-reset')
where id = 'a1800000-0000-4000-8000-000000000003';
update public.user_auth_security
set pin_reset_state = 'PENDING',
    pin_reset_requested_at = now(),
    pin_reset_expires_at = now() + interval '30 minutes',
    pin_reset_by = 'a1800000-0000-4000-8000-000000000001'
where user_id = 'a1800000-0000-4000-8000-000000000003';

set local role service_role;
select public.service_recover_prepared_pin_reset('a1800000-0000-4000-8000-000000000003');
reset role;

do $$
begin
  if not exists (
    select 1 from public.user_auth_security
    where user_id = 'a1800000-0000-4000-8000-000000000003'
      and pin_version = 2
      and pin_reset_state = 'ACTIVE'
  ) then raise exception 'Prepared PIN reset was not recovered'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_PIN_RESET_ACTIVATION_RECOVERED'
      and target = 'users:a1800000-0000-4000-8000-000000000003'
      and details not like '%1999999999702%'
  ) then raise exception 'Recovered reset audit was not redacted'; end if;
end;
$$;

set local role service_role;
do $$
declare
  result jsonb;
begin
  result := public.service_relink_orphaned_profile_for_pin_reset(
    'a1800000-0000-4000-8000-000000000001',
    'a1800000-0000-4000-8000-000000000002'
  );
  if result->>'status' <> 'ALREADY_RELINKED'
     or result->>'user_id' <> 'a1800000-0000-4000-8000-000000000003' then
    raise exception 'Relink retry was not idempotent';
  end if;
end;
$$;
reset role;

rollback;
