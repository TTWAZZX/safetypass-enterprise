begin;

insert into public.system_config(key, value)
values ('PASSING_SCORE_INDUCTION', '80')
on conflict (key) do update set value = excluded.value;

insert into public.questions(
  id, content_th, content_en, choices_json, correct_choice_index, type, is_active, pattern
) values (
  '44444444-4444-4444-8444-444444444444',
  'คำถามทดสอบ Phase 1',
  'Phase 1 test question',
  '[{"text_th":"ถูก","text_en":"Correct","is_correct":true}]'::jsonb,
  0,
  'INDUCTION',
  true,
  'MULTIPLE_CHOICE'
);

do $$
declare
  user_count bigint;
  contractor_count bigint;
  decrypted_value text;
  flag_value text;
begin
  select count(*) into user_count from public.users;
  select count(*) into contractor_count
  from public.user_training_access where program_code = 'CONTRACTOR';
  if contractor_count <> user_count then
    raise exception 'Contractor backfill count mismatch';
  end if;

  select value into flag_value from public.system_config
  where key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if flag_value is distinct from 'false' then
    raise exception 'Supplier & Outsource feature flag must be false';
  end if;

  if to_regprocedure('public.submit_exam_attempt(text,jsonb,text)') is not null then
    raise exception 'Legacy submit_exam_attempt RPC still exists';
  end if;

  if has_function_privilege('anon', 'public.submit_safety_exam(text,jsonb,text)', 'EXECUTE') then
    raise exception 'Anonymous role can execute submit_safety_exam';
  end if;
  if not has_function_privilege('anon', 'public.verify_induction_pass(text)', 'EXECUTE') then
    raise exception 'Anonymous verification access is missing';
  end if;

  if exists (select 1 from public.users where national_id_fingerprint is null) then
    raise exception 'National ID fingerprint backfill is incomplete';
  end if;

  if (select count(*) from public.users where national_id_fingerprint =
      encode(extensions.digest('1000000000001', 'sha256'), 'hex')) <> 2 then
    raise exception 'Duplicate national ID records were not preserved';
  end if;

  if (select count(*) from public.users where national_id_hash =
      encode(extensions.digest('1000000000001', 'sha256'), 'hex')) <> 1 then
    raise exception 'Duplicate national ID login hash is not canonical';
  end if;

  if not exists (
    select 1 from public.users
    where id = '11111111-1111-4111-8111-111111111111'
      and national_id = '1000000000001'
  ) then
    raise exception 'Raw national ID record was unexpectedly rewritten';
  end if;

  perform set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', true);
  select public.get_my_decrypted_id() into decrypted_value;
  if decrypted_value is distinct from '1000000000002' then
    raise exception 'Legacy ciphertext migration failed';
  end if;
end;
$$;

-- A normal authenticated user cannot change protected fields directly.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}', true);

do $$
declare
  exam_result jsonb;
  sanitized_choices jsonb;
begin
  begin
    update public.users
    set role = 'ADMIN', induction_expiry = now() + interval '10 years'
    where id = auth.uid();
    raise exception 'Protected-field update unexpectedly succeeded';
  exception
    when insufficient_privilege then null;
    when raise_exception then
      if sqlerrm = 'Protected-field update unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.add_my_training_access(array['SUPPLIER_OUTSOURCE'], 'supplier', 'Driver');
    raise exception 'Disabled program registration unexpectedly succeeded';
  exception
    when raise_exception then
      if sqlerrm = 'Disabled program registration unexpectedly succeeded' then raise; end if;
  end;

  select choices_json into sanitized_choices
  from public.get_exam_questions('INDUCTION')
  where id = '44444444-4444-4444-8444-444444444444';
  if sanitized_choices @> '[{"is_correct":true}]'::jsonb then
    raise exception 'Question RPC exposed a correct-answer flag';
  end if;

  select public.submit_safety_exam(
    'INDUCTION',
    '{"44444444-4444-4444-8444-444444444444":0}'::jsonb,
    null
  ) into exam_result;
  if (exam_result ->> 'passed')::boolean is not true or (exam_result ->> 'score')::integer <> 1 then
    raise exception 'Secure exam submission returned an unexpected result';
  end if;
  if not exists (
    select 1 from public.users where id = auth.uid() and induction_expiry > now()
  ) then
    raise exception 'Secure exam submission did not update induction expiry';
  end if;

  begin
    perform public.submit_safety_exam(
      'INDUCTION',
      '{"44444444-4444-4444-8444-444444444444":0}'::jsonb,
      null
    );
    raise exception 'Exam rate limit unexpectedly allowed a duplicate submission';
  exception
    when raise_exception then
      if sqlerrm = 'Exam rate limit unexpectedly allowed a duplicate submission' then raise; end if;
  end;
end;
$$;

reset role;

-- Verify safe public lookup and verification do not require plaintext storage.
do $$
declare
  status_record record;
  verify_record record;
begin
  select * into status_record from public.check_user_exists('1000000000001');
  if not status_record.user_exists or status_record.requires_registration or not status_record.is_active then
    raise exception 'Minimal registration status RPC returned an unexpected result';
  end if;

  select * into verify_record from public.verify_induction_pass('1000000000001');
  if verify_record.name is distinct from 'Phase One User' then
    raise exception 'Public induction verification selected a duplicate staged profile';
  end if;
  if verify_record.induction_expiry is null then
    raise exception 'Public induction verification omitted the valid expiry';
  end if;
end;
$$;

-- Test transactional first registration and automatic Contractor entitlement.
insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-4333-8333-333333333333',
  'authenticated',
  'authenticated',
  '1000000000003@safetypass.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select set_config('request.jwt.claims', '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}', true);
select public.complete_registration_v4(
  '1000000000003',
  'Phase One Registration',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  30,
  'ไทย (Thai)',
  null,
  array['CONTRACTOR']::text[],
  null,
  null,
  null,
  null
);
reset role;

do $$
begin
  if not exists (
    select 1 from public.users
    where id = '33333333-3333-4333-8333-333333333333'
      and national_id = '1000000000003'
      and national_id_hash is not null
      and national_id_fingerprint is not null
      and pdpa_agreed = true
  ) then
    raise exception 'Transactional registration did not create a searchable profile';
  end if;

  if not exists (
    select 1 from public.user_training_access
    where user_id = '33333333-3333-4333-8333-333333333333'
      and program_code = 'CONTRACTOR'
  ) then
    raise exception 'Transactional registration did not grant Contractor access';
  end if;
end;
$$;

rollback;
