do $$
declare
  table_name_value text;
begin
  foreach table_name_value in array array[
    'vendors', 'audit_logs', 'questions', 'question_revisions', 'system_config',
    'exam_history', 'exam_logs', 'work_permits', 'user_training_access',
    'supplier_outsource_passes'
  ] loop
    if has_table_privilege('authenticated', 'public.' || table_name_value, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || table_name_value, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || table_name_value, 'DELETE') then
      raise exception 'Authenticated retains direct write privilege on %', table_name_value;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.users', 'DELETE') then
    raise exception 'Authenticated retains direct user deletion';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_archive_user(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_archive_vendor(uuid)', 'EXECUTE') then
    raise exception 'Admin archive RPC grant is missing';
  end if;
  if has_function_privilege('anon', 'public.admin_archive_user(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_archive_vendor(uuid)', 'EXECUTE') then
    raise exception 'Anonymous role can call an admin archive RPC';
  end if;
end
$$;

insert into public.vendors(id, name, status)
values ('f4000000-0000-4000-8000-000000000001', 'Phase 4 Test Vendor', 'APPROVED');

insert into public.users(
  id, national_id, name, vendor_id, role, pdpa_agreed, is_active,
  national_id_hash, national_id_fingerprint
) values
  ('f4000000-0000-4000-8000-000000000002', '1888888888801', 'Phase 4 Test Admin', null, 'ADMIN', true, true,
   encode(extensions.digest('1888888888801', 'sha256'), 'hex'), encode(extensions.digest('1888888888801', 'sha256'), 'hex')),
  ('f4000000-0000-4000-8000-000000000003', '1888888888802', 'Phase 4 Test User', 'f4000000-0000-4000-8000-000000000001', 'USER', true, true,
   encode(extensions.digest('1888888888802', 'sha256'), 'hex'), encode(extensions.digest('1888888888802', 'sha256'), 'hex'));

insert into public.exam_history(id, user_id, exam_type, score, total_questions, status)
values ('f4000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000003', 'INDUCTION', 10, 10, 'PASSED');
insert into public.work_permits(id, user_id, permit_no, expire_date, status)
values ('f4000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000003', 'PHASE4-TEST', now() + interval '1 day', 'ACTIVE');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000002', true);
select public.admin_archive_user('f4000000-0000-4000-8000-000000000003');
select public.admin_archive_vendor('f4000000-0000-4000-8000-000000000001');
reset role;

do $$
begin
  if not exists (
    select 1 from public.users
    where id = 'f4000000-0000-4000-8000-000000000003' and is_active = false
  ) then raise exception 'User archive did not preserve and deactivate the row'; end if;
  if not exists (select 1 from public.exam_history where id = 'f4000000-0000-4000-8000-000000000004')
     or not exists (select 1 from public.work_permits where id = 'f4000000-0000-4000-8000-000000000005') then
    raise exception 'User archive deleted linked history';
  end if;
  if not exists (
    select 1 from public.vendors
    where id = 'f4000000-0000-4000-8000-000000000001' and status = 'REJECTED'
  ) then raise exception 'Vendor archive did not preserve and reject the row'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_USER_ARCHIVED' and target = 'users:f4000000-0000-4000-8000-000000000003'
  ) then raise exception 'User archive audit was not generated'; end if;
  if not exists (
    select 1 from public.audit_logs
    where action = 'ADMIN_VENDOR_ARCHIVED' and target = 'vendors:f4000000-0000-4000-8000-000000000001'
  ) then raise exception 'Vendor archive audit was not generated'; end if;
end
$$;
