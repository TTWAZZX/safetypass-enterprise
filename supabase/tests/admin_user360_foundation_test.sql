begin;

insert into auth.users(id, email, role, aud, created_at, updated_at)
values (
  'b1800000-0000-4000-8000-000000000001',
  '1999999999801@safetypass.com',
  'authenticated', 'authenticated', now(), now()
);

insert into public.vendors(id, name, status)
values ('b1800000-0000-4000-8000-000000000010', 'User 360 Test Vendor', 'APPROVED');

insert into public.users(
  id, national_id, name, role, pdpa_agreed, is_active,
  national_id_hash, national_id_fingerprint, nationality, age
) values
  (
    'b1800000-0000-4000-8000-000000000001', '1999999999801',
    'User 360 Admin', 'ADMIN', true, true,
    encode(extensions.digest('1999999999801', 'sha256'), 'hex'),
    encode(extensions.digest('1999999999801', 'sha256'), 'hex'),
    'ไทย (Thai)', 40
  ),
  (
    'b1800000-0000-4000-8000-000000000002', '1999999999802',
    'User 360 Target', 'USER', true, true,
    encode(extensions.digest('1999999999802', 'sha256'), 'hex'),
    encode(extensions.digest('1999999999802', 'sha256'), 'hex'),
    'ไทย (Thai)', 30
  ),
  (
    'b1800000-0000-4000-8000-000000000003', '1999999999803',
    'User 360 Non Admin', 'USER', true, true,
    encode(extensions.digest('1999999999803', 'sha256'), 'hex'),
    encode(extensions.digest('1999999999803', 'sha256'), 'hex'),
    'ไทย (Thai)', 30
  );

insert into public.user_training_access(user_id, program_code)
values
  ('b1800000-0000-4000-8000-000000000001', 'CONTRACTOR'),
  ('b1800000-0000-4000-8000-000000000002', 'CONTRACTOR'),
  ('b1800000-0000-4000-8000-000000000003', 'CONTRACTOR');

do $$
begin
  begin
    insert into public.admin_identity_operations(
      target_user_id, actor_user_id, old_fingerprint, new_fingerprint,
      old_masked_id, new_masked_id, reason
    ) values (
      'b1800000-0000-4000-8000-000000000002',
      'b1800000-0000-4000-8000-000000000001',
      'old-fingerprint', 'new-fingerprint', '199••••••9802', '188••••••9802',
      'Incorrect identity 1999999999802'
    );
    raise exception 'Identity ledger accepted a full national ID in reason';
  exception
    when check_violation then null;
    when raise_exception then raise;
  end;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b1800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare
  directory_value jsonb;
  directory_user jsonb;
  detail_value jsonb;
  update_value jsonb;
begin
  if public.admin_get_user360_feature_flag() is not false then
    raise exception 'User 360 feature flag must default to disabled';
  end if;
  if public.admin_set_user360_feature_flag(true) is not true then
    raise exception 'Admin could not enable User 360 feature flag';
  end if;

  directory_value := public.admin_get_directory_page(
    'USERS', 1, 10, '1999999999802', null, null
  );
  select row_value into directory_user
  from jsonb_array_elements(directory_value -> 'rows') row_value
  where row_value ->> 'id' = 'b1800000-0000-4000-8000-000000000002';

  if directory_user is null then raise exception 'National ID server-side search failed'; end if;
  if directory_user ->> 'national_id' = '1999999999802'
     or directory_user ->> 'national_id' <> public.mask_national_id('1999999999802') then
    raise exception 'Directory exposed or incorrectly masked the national ID';
  end if;

  detail_value := public.admin_get_user360('b1800000-0000-4000-8000-000000000002');
  if detail_value -> 'profile' ->> 'masked_national_id' <> public.mask_national_id('1999999999802')
     or (detail_value -> 'profile') ? 'national_id' then
    raise exception 'User 360 profile exposed the national ID';
  end if;
  if jsonb_array_length(detail_value -> 'programs') <> 1 then
    raise exception 'User 360 program read model is invalid';
  end if;

  update_value := public.admin_update_user360(
    'b1800000-0000-4000-8000-000000000002',
    'Updated User 360 Target', null, '1990-01-15', 'ไทย (Thai)',
    'b1800000-0000-4000-8000-000000000010', null,
    array['CONTRACTOR', 'SUPPLIER_OUTSOURCE'],
    'supplier', 'Driver', current_date, current_date + 30,
    'Assign both safety programs for test'
  );

  if update_value -> 'profile' ->> 'name' <> 'Updated User 360 Target'
     or jsonb_array_length(update_value -> 'programs') <> 2 then
    raise exception 'Atomic User 360 update failed';
  end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_TRAINING_PROGRAM_ADDED'
      and target = 'training_access:b1800000-0000-4000-8000-000000000002:SUPPLIER_OUTSOURCE'
  ) then raise exception 'Training program audit was not generated'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_USER360_UPDATED'
      and target = 'users:b1800000-0000-4000-8000-000000000002'
  ) then raise exception 'User 360 audit was not generated'; end if;
  if exists (
    select 1 from public.audit_logs
    where details like '%1999999999802%'
  ) then raise exception 'Audit details contain a full national ID'; end if;
  if exists (
    select 1 from public.audit_logs
    where admin_email ~ '^[0-9]{13}@'
  ) then raise exception 'Audit actor email contains a full national ID'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_USER360_UPDATED'
      and actor_user_id = 'b1800000-0000-4000-8000-000000000001'
  ) then raise exception 'Audit actor UUID was not recorded'; end if;

  begin
    perform public.admin_update_user360(
      'b1800000-0000-4000-8000-000000000002',
      'Updated User 360 Target', null, '1990-01-15', 'ไทย (Thai)',
      'b1800000-0000-4000-8000-000000000010', null,
      array['CONTRACTOR', 'SUPPLIER_OUTSOURCE'],
      'supplier', 'Driver', current_date, current_date + 30,
      'Do not store 1999999999802 in audit'
    );
    raise exception 'Change reason accepted a full national ID';
  exception
    when raise_exception then
      if sqlerrm = 'Change reason accepted a full national ID' then raise; end if;
      if sqlerrm <> 'Change reason must not contain a national ID' then raise; end if;
  end;
end
$$;

do $$
begin
  if public.admin_get_user360_feature_flag() is not true then
    raise exception 'Enabled User 360 feature flag was not persisted';
  end if;
end
$$;

reset role;

insert into public.exam_history(id, user_id, exam_type, score, total_questions, status, created_at)
values (
  'b1800000-0000-4000-8000-000000000020',
  'b1800000-0000-4000-8000-000000000002',
  'SUPPLIER_OUTSOURCE', 20, 20, 'PASSED', now()
);
insert into public.supplier_outsource_passes(
  id, user_id, exam_history_id, issued_at, expires_at, status
) values (
  'b1800000-0000-4000-8000-000000000021',
  'b1800000-0000-4000-8000-000000000002',
  'b1800000-0000-4000-8000-000000000020', now(), now() + interval '1 year', 'ACTIVE'
);
insert into public.work_permits(id, user_id, permit_no, expire_date, status)
values (
  'b1800000-0000-4000-8000-000000000022',
  'b1800000-0000-4000-8000-000000000002',
  '1919191919', now() + interval '1 day', 'ACTIVE'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b1800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.admin_update_user360(
  'b1800000-0000-4000-8000-000000000002',
  'Updated User 360 Target', null, '1990-01-15', 'ไทย (Thai)',
  'b1800000-0000-4000-8000-000000000010', null,
  array['CONTRACTOR', 'SUPPLIER_OUTSOURCE'],
  'supplier', 'Passenger', current_date, current_date + 30,
  'Change Supplier work type and revoke old pass'
);

do $$
begin
  if not exists (
    select 1 from public.supplier_outsource_passes
    where id = 'b1800000-0000-4000-8000-000000000021' and status = 'REVOKED'
  ) then raise exception 'Supplier pass was not revoked after entitlement change'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_SUPPLIER_PASS_REVOKED'
      and target = 'supplier_pass:b1800000-0000-4000-8000-000000000002:b1800000-0000-4000-8000-000000000021'
  ) then raise exception 'Supplier pass revocation audit was not generated'; end if;

  begin
    perform public.admin_update_user360(
      'b1800000-0000-4000-8000-000000000002',
      'Must Roll Back', null, '1990-01-15', 'ไทย (Thai)',
      'b1800000-0000-4000-8000-000000000010', null,
      array['SUPPLIER_OUTSOURCE'],
      'supplier', 'Passenger', current_date, current_date + 30,
      'Attempt Contractor removal with active permit'
    );
    raise exception 'Active Work Permit did not block Contractor removal';
  exception
    when raise_exception then
      if sqlerrm = 'Active Work Permit did not block Contractor removal' then raise; end if;
      if sqlerrm <> 'Active Work Permit must be revoked or expired before removing Contractor access' then raise; end if;
  end;

  if not exists (
    select 1 from public.users
    where id = 'b1800000-0000-4000-8000-000000000002'
      and name = 'Updated User 360 Target'
  ) then raise exception 'Failed atomic update did not roll back profile changes'; end if;
end
$$;

reset role;
update public.work_permits
set status = 'EXPIRED'
where id = 'b1800000-0000-4000-8000-000000000022';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b1800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.admin_update_user360(
  'b1800000-0000-4000-8000-000000000002',
  'Supplier Only User', null, '1990-01-15', 'ไทย (Thai)',
  'b1800000-0000-4000-8000-000000000010', null,
  array['SUPPLIER_OUTSOURCE'],
  'supplier', 'Passenger', current_date, current_date + 30,
  'Permit expired; change to Supplier only'
);

do $$
begin
  if exists (
    select 1 from public.user_training_access
    where user_id = 'b1800000-0000-4000-8000-000000000002'
      and program_code = 'CONTRACTOR'
  ) then raise exception 'Contractor program was not removed'; end if;
  if not exists (
    select 1 from public.work_permits
    where id = 'b1800000-0000-4000-8000-000000000022'
  ) then raise exception 'Work Permit history was deleted'; end if;

  begin
    perform public.admin_update_user360(
      'b1800000-0000-4000-8000-000000000002',
      'No Program User', null, '1990-01-15', 'ไทย (Thai)',
      'b1800000-0000-4000-8000-000000000010', null,
      array[]::text[], null, null, null, null,
      'Attempt to remove every program'
    );
    raise exception 'Active user was left without a program';
  exception
    when raise_exception then
      if sqlerrm = 'Active user was left without a program' then raise; end if;
      if sqlerrm <> 'Active users must have at least one training program' then raise; end if;
  end;
end
$$;

select set_config('request.jwt.claim.sub', 'b1800000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"b1800000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.admin_get_user360('b1800000-0000-4000-8000-000000000002');
    raise exception 'Non-admin unexpectedly accessed User 360';
  exception
    when raise_exception then
      if sqlerrm = 'Non-admin unexpectedly accessed User 360' then raise; end if;
      if sqlerrm <> 'Admin access required' then raise; end if;
  end;

  begin
    perform public.admin_get_user360_feature_flag();
    raise exception 'Non-admin unexpectedly read User 360 feature flag';
  exception
    when raise_exception then
      if sqlerrm = 'Non-admin unexpectedly read User 360 feature flag' then raise; end if;
      if sqlerrm <> 'Admin access required' then raise; end if;
  end;

  begin
    perform count(*) from public.admin_identity_operations;
    raise exception 'Authenticated user unexpectedly accessed identity operation ledger';
  exception
    when insufficient_privilege then null;
    when raise_exception then raise;
  end;
end
$$;

reset role;
rollback;
