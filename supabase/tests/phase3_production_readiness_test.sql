begin;

update public.system_config set value = 'true' where key = 'SUPPLIER_OUTSOURCE_ENABLED';
delete from public.supplier_outsource_passes
where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999'
);
delete from public.exam_logs
where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999'
) and exam_type = 'SUPPLIER_OUTSOURCE';
delete from public.exam_history
where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999'
) and exam_type = 'SUPPLIER_OUTSOURCE';
delete from public.user_training_access
where user_id in (
  '11111111-1111-4111-8111-111111111111',
  '99999999-9999-4999-8999-999999999999'
) and program_code = 'SUPPLIER_OUTSOURCE';
insert into public.questions(
  id, content_th, content_en, choices_json, correct_choice_index, type, is_active, pattern
) values (
  '88888888-8888-4888-8888-888888888888',
  'คำถามทดสอบ Phase 3',
  'Phase 3 test question',
  '[{"text_th":"ถูก","text_en":"Correct","is_correct":true},{"text_th":"ผิด","text_en":"Incorrect","is_correct":false}]'::jsonb,
  0, 'SUPPLIER_OUTSOURCE', true, 'MULTIPLE_CHOICE'
);
insert into public.questions(
  id, content_th, content_en, choices_json, correct_choice_index, type, is_active, pattern
)
select gen_random_uuid(), 'คำถามทดสอบ Phase 3 เพิ่มเติม ' || value, 'Additional Phase 3 question ' || value,
  '[{"text_th":"ถูก","text_en":"Correct","is_correct":true},{"text_th":"ผิด","text_en":"Incorrect","is_correct":false}]'::jsonb,
  0, 'SUPPLIER_OUTSOURCE', true, 'MULTIPLE_CHOICE'
from generate_series(1, 19) value;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$
declare
  question_value record;
  result_value jsonb;
  answers_value jsonb;
  pass_token uuid;
begin
  perform public.add_my_supplier_outsource_access('supplier', 'Driver', current_date, current_date + 30);

  select * into question_value
  from public.get_exam_questions('SUPPLIER_OUTSOURCE')
  where id = '88888888-8888-4888-8888-888888888888';
  if question_value.id is null then raise exception 'Supplier question was not returned'; end if;
  if question_value.choices_json @> '[{"is_correct":true}]'::jsonb
     or question_value.choices_json::text like '%correct_answer%' then
    raise exception 'Question answer leaked to client';
  end if;

  select jsonb_object_agg(id::text, '0'::jsonb) into answers_value
  from public.get_exam_questions('SUPPLIER_OUTSOURCE');
  result_value := public.submit_safety_exam('SUPPLIER_OUTSOURCE', answers_value, null);
  if not (result_value ->> 'passed')::boolean then raise exception 'Supplier pass failed'; end if;
  pass_token := (result_value ->> 'verificationToken')::uuid;
  perform set_config('phase3.pass_token', pass_token::text, true);
end;
$$;
reset role;

update public.exam_history
set created_at = now() - interval '2 minutes'
where user_id = '11111111-1111-4111-8111-111111111111'
  and exam_type = 'SUPPLIER_OUTSOURCE';

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);
do $$
declare
  result_value jsonb;
  wrong_answers_value jsonb;
  correct_answers_value jsonb;
  pass_token uuid := current_setting('phase3.pass_token')::uuid;
  status_value record;
begin
  select jsonb_object_agg(id::text, '1'::jsonb), jsonb_object_agg(id::text, '0'::jsonb)
  into wrong_answers_value, correct_answers_value
  from public.get_exam_questions('SUPPLIER_OUTSOURCE');
  result_value := public.submit_safety_exam('SUPPLIER_OUTSOURCE', wrong_answers_value, null);
  if (result_value ->> 'passed')::boolean then raise exception 'Failed retake passed unexpectedly'; end if;

  select * into status_value from public.get_my_supplier_outsource_status();
  if status_value.verification_token is distinct from pass_token
     or status_value.last_status <> 'PASSED' then
    raise exception 'A failed retake hid the active pass';
  end if;

  begin
    perform public.submit_safety_exam('SUPPLIER_OUTSOURCE', correct_answers_value, null);
    raise exception 'Rate limit did not block a repeated submission';
  exception when raise_exception then
    if sqlerrm = 'Rate limit did not block a repeated submission' then raise; end if;
  end;

  begin
    perform public.link_my_line_identity('invalid-line-user');
    raise exception 'Invalid LINE user ID was accepted';
  exception when raise_exception then
    if sqlerrm = 'Invalid LINE user ID was accepted' then raise; end if;
  end;

  perform public.add_my_supplier_outsource_access('supplier', 'Passenger', current_date, current_date + 30);
  select * into status_value from public.get_my_supplier_outsource_status();
  if status_value.verification_token is not null or status_value.passed_at is not null then
    raise exception 'Material access change did not revoke the pass';
  end if;
  if not exists (
    select 1 from public.supplier_outsource_passes
    where verification_token = pass_token and status = 'REVOKED'
  ) then raise exception 'Revoked pass was not retained for audit'; end if;
end;
$$;
reset role;

insert into auth.users(id, email, role, aud, created_at, updated_at)
values (
  '99999999-9999-4999-8999-999999999999',
  '1000000000003@safetypass.com', 'authenticated', 'authenticated', now(), now()
);
insert into public.users(
  id, national_id, name, vendor_id, role, pdpa_agreed, pdpa_agreed_at,
  is_active, national_id_hash, national_id_fingerprint
) values (
  '99999999-9999-4999-8999-999999999999', '1000000000003', 'Phase Three Outsource',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'USER', true, now(), true,
  encode(extensions.digest('1000000000003', 'sha256'), 'hex'),
  encode(extensions.digest('1000000000003', 'sha256'), 'hex')
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claims', '{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}', true);

select public.add_my_supplier_outsource_access('outsource', 'Trainee', current_date + 1, current_date + 10);
do $$
begin
  begin
    perform public.get_exam_questions('SUPPLIER_OUTSOURCE');
    raise exception 'Future access returned questions';
  exception when raise_exception then
    if sqlerrm = 'Future access returned questions' then raise; end if;
  end;
end;
$$;

select public.add_my_supplier_outsource_access('outsource', 'Trainee', current_date - 10, current_date - 1);
do $$
begin
  begin
    perform public.get_exam_questions('SUPPLIER_OUTSOURCE');
    raise exception 'Expired access returned questions';
  exception when raise_exception then
    if sqlerrm = 'Expired access returned questions' then raise; end if;
  end;
end;
$$;

select public.add_my_supplier_outsource_access('outsource', 'Trainee', current_date, current_date + 10);
do $$
declare question_count integer;
begin
  select count(*) into question_count
  from public.get_exam_questions('SUPPLIER_OUTSOURCE')
  where id = '88888888-8888-4888-8888-888888888888';
  if question_count <> 1 then raise exception 'Outsource did not receive the shared question set'; end if;
end;
$$;
reset role;

set local role anon;
do $$
begin
  if (select supplier_outsource_enabled from public.get_public_feature_flags()) is not true then
    raise exception 'Public feature status is incorrect';
  end if;
  if exists (
    select 1 from public.verify_supplier_outsource_pass('00000000-0000-0000-0000-000000000000')
  ) then raise exception 'Fake verification token returned a record'; end if;
  begin
    perform public.admin_supplier_outsource_report();
    raise exception 'Anonymous admin report access was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);
do $$
declare report_value record;
begin
  select * into report_value
  from public.admin_supplier_outsource_report()
  where user_id = '99999999-9999-4999-8999-999999999999';
  if report_value.participant_type <> 'outsource' or report_value.work_type <> 'Trainee' then
    raise exception 'Admin report filters received invalid data';
  end if;
  perform public.admin_set_supplier_outsource_access(
    '99999999-9999-4999-8999-999999999999', true,
    'outsource', 'Driver', current_date, current_date + 10
  );
  if not exists (
    select 1 from public.user_training_access
    where user_id = '99999999-9999-4999-8999-999999999999'
      and program_code = 'SUPPLIER_OUTSOURCE' and work_type = 'Driver'
  ) then raise exception 'Admin edit did not update work type'; end if;
  perform public.admin_set_supplier_outsource_access(
    '99999999-9999-4999-8999-999999999999', false, null, null, null, null
  );
  if exists (
    select 1 from public.user_training_access
    where user_id = '99999999-9999-4999-8999-999999999999'
      and program_code = 'SUPPLIER_OUTSOURCE'
  ) then raise exception 'Admin revoke did not remove entitlement'; end if;
end;
$$;
reset role;

update public.system_config set value = 'false' where key = 'SUPPLIER_OUTSOURCE_ENABLED';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $$
begin
  begin
    perform public.add_my_supplier_outsource_access('supplier', 'Driver', current_date, current_date + 1);
    raise exception 'Disabled feature accepted self-enrollment';
  exception when raise_exception then
    if sqlerrm = 'Disabled feature accepted self-enrollment' then raise; end if;
  end;
end;
$$;
reset role;

rollback;
