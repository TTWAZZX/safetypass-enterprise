begin;

insert into public.vendors(id, name, status)
values
  ('88888888-8888-4888-8888-888888888801', 'Vendor Duplicate Control Alpha', 'APPROVED'),
  ('88888888-8888-4888-8888-888888888802', 'Phase Vendor Pending', 'PENDING');

do $$
declare
  exact_match record;
begin
  select * into exact_match
  from public.find_vendor_name_matches(' vendor-duplicate control alpha ', null, 5)
  where match_type = 'EXACT';

  if exact_match.id is distinct from '88888888-8888-4888-8888-888888888801'::uuid then
    raise exception 'Exact normalized vendor match was not found';
  end if;

  begin
    insert into public.vendors(name, status)
    values ('Vendor-Duplicate Control Alpha', 'PENDING');
    raise exception 'Duplicate vendor insert unexpectedly succeeded';
  exception
    when unique_violation then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}', true);

do $$
declare
  save_result jsonb;
begin
  select public.admin_save_vendor(
    null::uuid,
    'Vendor Duplicate Control Alfa',
    'APPROVED',
    false
  ) into save_result;

  if save_result ->> 'reason' <> 'SIMILAR'
     or jsonb_array_length(save_result -> 'matches') = 0 then
    raise exception 'Similar vendor confirmation guard failed: %', save_result;
  end if;
end;
$$;

reset role;

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88888888-8888-4888-8888-888888888899',
  'authenticated', 'authenticated', '1000000000099@safetypass.com', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888899', true);
select set_config('request.jwt.claims', '{"sub":"88888888-8888-4888-8888-888888888899","role":"authenticated"}', true);

do $$
declare
  registration_result jsonb;
begin
  select public.complete_registration_v3(
    '1000000000099',
    'Vendor Registration Test',
    null,
    30,
    'ไทย (Thai)',
    ' Phase-Vendor Pending ',
    array['CONTRACTOR'],
    null,
    null,
    null,
    null
  ) into registration_result;

  if registration_result ->> 'vendor_resolution' <> 'EXISTING_PENDING'
     or (registration_result ->> 'vendor_request_created')::boolean is true
     or registration_result ->> 'vendor_id' <> '88888888-8888-4888-8888-888888888802' then
    raise exception 'Registration did not reuse the pending vendor: %', registration_result;
  end if;
end;
$$;

reset role;
rollback;
