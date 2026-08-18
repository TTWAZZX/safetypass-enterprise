begin;

insert into auth.users(id, email, role, aud, created_at, updated_at)
values ('c1800000-0000-4000-8000-000000000001', '1999999999701@safetypass.com', 'authenticated', 'authenticated', now(), now());

insert into public.users(
  id, national_id, name, role, is_active, pdpa_agreed,
  national_id_hash, national_id_fingerprint, nationality, age
) values
  ('c1800000-0000-4000-8000-000000000001', '1999999999701', 'Identity Admin', 'ADMIN', true, true,
   encode(extensions.digest('1999999999701', 'sha256'), 'hex'), encode(extensions.digest('1999999999701', 'sha256'), 'hex'), 'ไทย (Thai)', 40),
  ('c1800000-0000-4000-8000-000000000002', '1999999999702', 'Identity Happy Path', 'USER', true, true,
   encode(extensions.digest('1999999999702', 'sha256'), 'hex'), encode(extensions.digest('1999999999702', 'sha256'), 'hex'), 'ไทย (Thai)', 30),
  ('c1800000-0000-4000-8000-000000000003', '1999999999703', 'Identity Rollback', 'USER', true, true,
   encode(extensions.digest('1999999999703', 'sha256'), 'hex'), encode(extensions.digest('1999999999703', 'sha256'), 'hex'), 'ไทย (Thai)', 31),
  ('c1800000-0000-4000-8000-000000000004', '1999999999704', 'Identity Recovery', 'USER', true, true,
   encode(extensions.digest('1999999999704', 'sha256'), 'hex'), encode(extensions.digest('1999999999704', 'sha256'), 'hex'), 'ไทย (Thai)', 32),
  ('c1800000-0000-4000-8000-000000000005', '1999999999705', 'Identity Non Admin', 'USER', true, true,
   encode(extensions.digest('1999999999705', 'sha256'), 'hex'), encode(extensions.digest('1999999999705', 'sha256'), 'hex'), 'ไทย (Thai)', 33);

insert into public.user_training_access(user_id, program_code)
select id, 'CONTRACTOR' from public.users where id::text like 'c1800000-%';

insert into public.exam_history(id, user_id, exam_type, score, total_questions, status, created_at)
values ('c1800000-0000-4000-8000-000000000020', 'c1800000-0000-4000-8000-000000000002', 'INDUCTION', 10, 10, 'PASSED', now());
insert into public.work_permits(id, user_id, permit_no, expire_date, status)
values ('c1800000-0000-4000-8000-000000000021', 'c1800000-0000-4000-8000-000000000002', 'ID-WP-001', now() + interval '1 day', 'ACTIVE');

do $$
declare
  target jsonb;
  export_rows integer;
  attempt jsonb;
  operation jsonb;
  operation_id uuid;
  result_value jsonb;
  i integer;
begin
  target := public.service_get_admin_identity_target(
    'c1800000-0000-4000-8000-000000000001', 'c1800000-0000-4000-8000-000000000002'
  );
  if target ->> 'national_id' <> '1999999999702' then raise exception 'Service reveal target failed'; end if;

  select count(*) into export_rows
  from public.service_get_admin_identity_export(
    'c1800000-0000-4000-8000-000000000001',
    array['c1800000-0000-4000-8000-000000000002'::uuid]
  );
  if export_rows <> 1 then raise exception 'Service export failed'; end if;

  for i in 1..6 loop
    attempt := public.service_begin_admin_identity_action(
      'c1800000-0000-4000-8000-000000000001',
      'c1800000-0000-4000-8000-000000000002', 'REVEAL', 'Authorized identity verification'
    );
    if i <= 5 and attempt ->> 'allowed' <> 'true' then raise exception 'Reveal was rate-limited too early'; end if;
    if i = 6 and (attempt ->> 'allowed' <> 'false' or attempt ->> 'error_code' <> 'RATE_LIMITED') then
      raise exception 'Reveal rate limit was not enforced';
    end if;
    if i <= 5 then
      perform public.service_complete_admin_identity_action(
        (attempt ->> 'attempt_id')::uuid,
        'c1800000-0000-4000-8000-000000000001',
        'ADMIN_NATIONAL_ID_REVEAL_SUCCEEDED', 'Authorized identity verification',
        true, null, '{}'::jsonb
      );
    end if;
  end loop;

  operation := public.service_prepare_national_id_correction(
    'c1800000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000002',
    '1888888888802', 'Correct verified government document'
  );
  operation_id := (operation ->> 'operation_id')::uuid;
  perform public.service_mark_identity_auth_updated(operation_id);
  result_value := public.service_finalize_national_id_correction(operation_id, '1888888888802');
  if result_value ->> 'status' <> 'COMPLETED' then raise exception 'Correction did not complete'; end if;
  if not exists (
    select 1 from public.users where id = 'c1800000-0000-4000-8000-000000000002'
      and national_id = '1888888888802'
      and national_id_hash = encode(extensions.digest('1888888888802', 'sha256'), 'hex')
      and national_id_fingerprint = encode(extensions.digest('1888888888802', 'sha256'), 'hex')
  ) then raise exception 'Corrected identity fields are inconsistent'; end if;
  if not exists (select 1 from public.exam_history where id = 'c1800000-0000-4000-8000-000000000020')
     or not exists (select 1 from public.work_permits where id = 'c1800000-0000-4000-8000-000000000021') then
    raise exception 'Correction deleted linked history';
  end if;

  operation := public.service_prepare_national_id_correction(
    'c1800000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000003',
    '1888888888803', 'Rollback failure injection'
  );
  operation_id := (operation ->> 'operation_id')::uuid;
  perform public.service_mark_identity_auth_updated(operation_id);
  result_value := public.service_rollback_national_id_correction(operation_id, 'FINALIZE_FAILED');
  if result_value ->> 'status' <> 'ROLLED_BACK'
     or not exists (select 1 from public.users where id = 'c1800000-0000-4000-8000-000000000003' and national_id = '1999999999703') then
    raise exception 'Correction rollback did not preserve original identity';
  end if;

  operation := public.service_prepare_national_id_correction(
    'c1800000-0000-4000-8000-000000000001',
    'c1800000-0000-4000-8000-000000000004',
    '1888888888804', 'Recovery failure injection'
  );
  operation_id := (operation ->> 'operation_id')::uuid;
  perform public.service_mark_identity_auth_updated(operation_id);
  perform public.service_mark_identity_recovery_required(operation_id, 'COMPENSATION_FAILED');
  result_value := public.service_finalize_national_id_correction(operation_id, '1888888888804');
  if result_value ->> 'status' <> 'COMPLETED' then raise exception 'Recovery finalize was not idempotent'; end if;

  if exists (
    select 1 from public.audit_logs audit
    where audit.target like 'users:c1800000-%'
      and (audit.details like '%199999999970%'
        or audit.details like '%188888888880%'
        or audit.admin_email ~ '^[0-9]{13}@')
  ) then raise exception 'Identity audit leaked a full national ID'; end if;
end
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1800000-0000-4000-8000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"c1800000-0000-4000-8000-000000000005","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.service_get_admin_identity_target(
      'c1800000-0000-4000-8000-000000000005',
      'c1800000-0000-4000-8000-000000000002'
    );
    raise exception 'Authenticated user reached service identity boundary';
  exception
    when insufficient_privilege then null;
    when raise_exception then raise;
  end;
end
$$;

reset role;
rollback;
