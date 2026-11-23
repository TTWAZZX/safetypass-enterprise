begin;

insert into public.users (id, national_id, name, role, is_active, pdpa_agreed, induction_expiry, national_id_fingerprint)
values
  ('c2300000-0000-4000-8000-000000000001', '1888888888901', 'Active administrator', 'ADMIN', true, true, null,
    encode(extensions.digest('1888888888901', 'sha256'), 'hex')),
  ('c2300000-0000-4000-8000-000000000002', '1888888888902', 'Contractor', 'USER', true, true, now() + interval '1 day',
    encode(extensions.digest('1888888888902', 'sha256'), 'hex')),
  ('c2300000-0000-4000-8000-000000000003', '1888888888903', 'Supplier only', 'USER', true, true, null,
    encode(extensions.digest('1888888888903', 'sha256'), 'hex')),
  ('c2300000-0000-4000-8000-000000000004', '1888888888904', 'Inactive administrator', 'ADMIN', false, true, null,
    encode(extensions.digest('1888888888904', 'sha256'), 'hex'));

insert into public.user_training_access (user_id, program_code, participant_type, work_type)
values ('c2300000-0000-4000-8000-000000000003', 'SUPPLIER_OUTSOURCE', 'supplier', 'Driver');
insert into public.user_training_access (user_id, program_code)
values ('c2300000-0000-4000-8000-000000000001', 'CONTRACTOR'),
       ('c2300000-0000-4000-8000-000000000002', 'CONTRACTOR');
insert into public.work_permits (user_id, permit_no, status, expire_date)
values ('c2300000-0000-4000-8000-000000000002', '1234500002', 'ACTIVE', now() + interval '1 day');

select set_config('test.induction_token', induction_verification_token::text, true)
from public.users where id = 'c2300000-0000-4000-8000-000000000002';
select set_config('test.permit_token', verification_token::text, true)
from public.work_permits where permit_no = '1234500002';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000003', true);
do $$
begin
  if has_table_privilege('authenticated', 'public.users', 'INSERT')
    or has_column_privilege('authenticated', 'public.users', 'role', 'UPDATE')
    or has_function_privilege('authenticated', 'public.submit_safety_exam_internal(text,jsonb,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.complete_registration_v4_internal(text,text,uuid,integer,text,text,text[],text,text,date,date)', 'EXECUTE') then
    raise exception 'Client has a bypass privilege';
  end if;
  update public.users set name = 'Updated supplier name' where id = auth.uid();
  if not found then raise exception 'A user could not update their own name'; end if;
  begin
    perform public.get_exam_questions('INDUCTION');
    raise exception 'Supplier-only account received Contractor questions';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_safety_exam('INDUCTION', '{}'::jsonb);
    raise exception 'Supplier-only account submitted a Contractor exam';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_issue_registration_invitation('1888888888905');
    raise exception 'Non-admin account issued an invitation';
  exception when insufficient_privilege then null;
  end;
end
$$;

select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000002', true);
select count(*) from public.get_exam_questions('INDUCTION');
select count(*) from public.get_exam_questions('WORK_PERMIT');

select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000001', true);
do $$
begin
  if not public.is_admin() then raise exception 'Active administrator lost access'; end if;
  if exists (select 1 from public.users where id <> auth.uid()) then
    raise exception 'Administrator can still read another user directly';
  end if;
  if not exists (
    select 1 from public.admin_list_users()
    where id = 'c2300000-0000-4000-8000-000000000002' and national_id = public.mask_national_id('1888888888902')
  ) then raise exception 'Masked administrator directory is unavailable'; end if;
end
$$;
select set_config('test.invitation_code', public.admin_issue_registration_invitation('1888888888905'), true);

select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000004', true);
do $$
begin
  if public.is_admin() then raise exception 'Inactive administrator still has access'; end if;
end
$$;

set local role anon;
do $$
begin
  if not exists (
    select 1 from public.verify_induction_pass_token(current_setting('test.induction_token')::uuid)
    where is_active and name = 'Contractor'
  ) or not exists (
    select 1 from public.verify_work_permit_token(current_setting('test.permit_token')::uuid)
    where is_active and permit_no = '1234500002'
  ) then raise exception 'An issued pass could not be verified by token'; end if;
  if not exists (select 1 from public.verify_safety_pass('1234500002') where is_active) then
    raise exception 'Previously printed permit cannot be verified';
  end if;
end
$$;

reset role;
update public.system_config set value = 'true' where key = 'REGISTRATION_INVITATION_REQUIRED';
update public.user_auth_security set pin_version = 2
where user_id = 'c2300000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000001', true);
do $$
begin
  if not public.is_admin() then raise exception 'Administrator with a private PIN lost access'; end if;
end
$$;
select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000002', true);
do $$
begin
  begin
    perform public.get_exam_questions('INDUCTION');
    raise exception 'A legacy account with incomplete PIN upgrade can access the exam';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.repair_my_orphaned_registration();
    raise exception 'An unverified client called self-service repair';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
insert into auth.users (id, email)
values ('c2300000-0000-4000-8000-000000000005', '1888888888905@safetypass.com');
do $$
begin
  if public.service_get_registration_invitation('1888888888905', 'wrong') is not null then
    raise exception 'Invalid invitation code was accepted';
  end if;
end
$$;
select set_config('test.invitation_id',
  public.service_get_registration_invitation('1888888888905', current_setting('test.invitation_code'))::text, true);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2300000-0000-4000-8000-000000000005', true);
do $$
begin
  begin
    perform public.complete_registration_v4('1888888888905', 'Invited User', null, 30, 'Thai', 'Invite test vendor');
    raise exception 'Registration was allowed without a verified invitation';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims', jsonb_build_object('app_metadata',
    jsonb_build_object('registration_invitation_id', current_setting('test.invitation_id')))::text, true);
  perform public.complete_registration_v4('1888888888905', 'Invited User', null, 30, 'Thai', 'Invite test vendor');
  if not exists (select 1 from public.users where id = auth.uid() and pdpa_agreed) then
    raise exception 'Invited user could not complete registration';
  end if;
  begin
    perform public.get_exam_questions('INDUCTION');
    raise exception 'New user could take an exam before setting a private PIN';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
select public.complete_auth_pin_change('c2300000-0000-4000-8000-000000000005', '1888888888905');
do $$
begin
  if public.service_get_registration_invitation('1888888888905', current_setting('test.invitation_code')) is not null then
    raise exception 'Redeemed invitation can be used again';
  end if;
  if not exists (
    select 1 from public.user_auth_security
    where user_id = 'c2300000-0000-4000-8000-000000000005'
      and pin_version = 2 and not pin_setup_required
  ) then raise exception 'Private PIN was not finalized'; end if;
end
$$;

set local role authenticated;
select count(*) from public.get_exam_questions('INDUCTION');
reset role;

rollback;
