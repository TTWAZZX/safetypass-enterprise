begin;

update public.system_config set value = 'true' where key = 'SUPPLIER_OUTSOURCE_ENABLED';
insert into public.questions(
  id, content_th, content_en, choices_json, correct_choice_index, type, is_active, pattern
) values (
  '66666666-6666-4666-8666-666666666666',
  'คำถามทดสอบ Supplier และ Outsource',
  'Supplier and Outsource test question',
  '[{"text_th":"ถูก","text_en":"Correct","is_correct":true}]'::jsonb,
  0, 'SUPPLIER_OUTSOURCE', true, 'MULTIPLE_CHOICE'
);
insert into public.questions(
  id, content_th, content_en, choices_json, correct_choice_index, type, is_active, pattern
)
select gen_random_uuid(), 'คำถามทดสอบเพิ่มเติม ' || value, 'Additional test question ' || value,
  '[{"text_th":"ถูก","text_en":"Correct","is_correct":true}]'::jsonb,
  0, 'SUPPLIER_OUTSOURCE', true, 'MULTIPLE_CHOICE'
from generate_series(1, 19) value;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

select public.add_my_supplier_outsource_access('supplier', 'Driver', current_date, current_date + 30);
select public.link_my_line_identity('U0123456789abcdef0123456789abcdef');

do $$
declare
  choices_value jsonb;
  result_value jsonb;
  answers_value jsonb;
  status_value record;
begin
  if not exists (
    select 1 from public.user_training_access
    where user_id = auth.uid() and program_code = 'CONTRACTOR'
  ) then raise exception 'Existing Contractor access was changed'; end if;
  if not exists (
    select 1 from public.user_training_access
    where user_id = auth.uid() and program_code = 'SUPPLIER_OUTSOURCE'
      and participant_type = 'supplier' and work_type = 'Driver'
      and access_start_date = current_date and access_end_date = current_date + 30
  ) then raise exception 'Supplier access was not created'; end if;

  select choices_json into choices_value
  from public.get_exam_questions('SUPPLIER_OUTSOURCE')
  where id = '66666666-6666-4666-8666-666666666666';
  if choices_value @> '[{"is_correct":true}]'::jsonb then
    raise exception 'Supplier question exposed the answer';
  end if;

  select jsonb_object_agg(id::text, '0'::jsonb) into answers_value
  from public.get_exam_questions('SUPPLIER_OUTSOURCE');
  select public.submit_safety_exam('SUPPLIER_OUTSOURCE', answers_value, null) into result_value;
  if (result_value ->> 'passed')::boolean is not true
     or nullif(result_value ->> 'verificationToken', '') is null then
    raise exception 'Supplier exam did not create a verified pass: %', result_value;
  end if;

  select * into status_value from public.get_my_supplier_outsource_status();
  if status_value.participant_type <> 'supplier' or status_value.last_score <> 20
     or status_value.total_questions <> 20
     or status_value.verification_token is null or status_value.expires_at <= now() then
    raise exception 'Supplier status RPC returned an invalid result';
  end if;

  if exists (
    select 1 from public.user_training_access
    where user_id <> auth.uid() and program_code = 'SUPPLIER_OUTSOURCE'
  ) then raise exception 'User can view another user training access'; end if;
end;
$$;
reset role;

select set_config('phase2.verification_token', (
  select verification_token::text from public.supplier_outsource_passes
  where user_id = '11111111-1111-4111-8111-111111111111' limit 1
), true);

set local role anon;
do $$
declare verify_value record;
begin
  select * into verify_value
  from public.verify_supplier_outsource_pass(current_setting('phase2.verification_token')::uuid);
  if verify_value.name <> 'Phase One User' or not verify_value.is_active
     or verify_value.participant_type <> 'supplier' then
    raise exception 'Anonymous supplier verification failed';
  end if;
  begin
    perform public.submit_safety_exam('SUPPLIER_OUTSOURCE', '{}'::jsonb, null);
    raise exception 'Anonymous supplier submission unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm = 'Anonymous supplier submission unexpectedly succeeded' then raise; end if;
  end;
end;
$$;
reset role;

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-4777-8777-777777777777',
  'authenticated', 'authenticated', '1000000000007@safetypass.com', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);
select public.complete_registration_v4(
  '1000000000007', 'Supplier Only Registration',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 28, 'ไทย (Thai)', null,
  array['SUPPLIER_OUTSOURCE'], 'outsource', 'Trainee', current_date, current_date + 15
);
reset role;

do $$
begin
  if exists (
    select 1 from public.user_training_access
    where user_id = '77777777-7777-4777-8777-777777777777' and program_code = 'CONTRACTOR'
  ) then raise exception 'Supplier-only registration received Contractor access'; end if;
  if not exists (
    select 1 from public.user_training_access
    where user_id = '77777777-7777-4777-8777-777777777777'
      and program_code = 'SUPPLIER_OUTSOURCE' and participant_type = 'outsource' and work_type = 'Trainee'
  ) then raise exception 'Supplier-only registration did not create access'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
do $$
declare report_count integer;
  launch_value record;
begin
  select count(*) into report_count from public.admin_supplier_outsource_report();
  if report_count < 2 then raise exception 'Admin supplier report is incomplete'; end if;
  perform public.admin_set_supplier_outsource_access(
    '77777777-7777-4777-8777-777777777777', true,
    'outsource', 'Passenger', current_date, current_date + 20
  );
  if not exists (
    select 1 from public.user_training_access
    where user_id = '77777777-7777-4777-8777-777777777777' and work_type = 'Passenger'
  ) then raise exception 'Admin access update failed'; end if;
  if public.admin_set_supplier_outsource_access_bulk(
    array[
      '11111111-1111-4111-8111-111111111111'::uuid,
      '77777777-7777-4777-8777-777777777777'::uuid
    ], 'supplier', 'Driver', current_date, null
  ) <> 2 then raise exception 'Admin bulk access count is invalid'; end if;
  if exists (
    select 1 from public.user_training_access
    where user_id in (
      '11111111-1111-4111-8111-111111111111',
      '77777777-7777-4777-8777-777777777777'
    ) and (access_start_date <> current_date or access_end_date <> (current_date + interval '1 year')::date)
  ) then raise exception 'Admin bulk access dates are invalid'; end if;
  select * into launch_value from public.admin_get_supplier_outsource_launch_status();
  if launch_value.active_question_count <> 20 then raise exception 'Launch status question count is invalid'; end if;
  perform public.admin_set_supplier_outsource_feature(true);
  update public.questions set is_active = false where id = '66666666-6666-4666-8666-666666666666';
  perform public.admin_set_supplier_outsource_feature(false);
  begin
    perform public.admin_set_supplier_outsource_feature(true);
    raise exception 'Feature enabled with fewer than 20 active questions';
  exception
    when raise_exception then
      if sqlerrm = 'Feature enabled with fewer than 20 active questions' then raise; end if;
  end;
  update public.questions set is_active = true where id = '66666666-6666-4666-8666-666666666666';
end;
$$;
reset role;

update public.system_config set value = 'false' where key = 'SUPPLIER_OUTSOURCE_ENABLED';
set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
do $$
begin
  begin
    perform public.get_exam_questions('SUPPLIER_OUTSOURCE');
    raise exception 'Disabled feature unexpectedly returned questions';
  exception
    when raise_exception then
      if sqlerrm = 'Disabled feature unexpectedly returned questions' then raise; end if;
  end;
end;
$$;
reset role;

rollback;
