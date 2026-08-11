begin;

insert into public.vendors(id, name, status)
values ('77777777-7777-4777-8777-777777777771', 'Staged Registration Vendor', 'APPROVED');

insert into public.users(
  id, national_id, name, vendor_id, role, age, nationality,
  pdpa_agreed, is_active, national_id_hash, national_id_fingerprint
) values (
  '77777777-7777-4777-8777-777777777772',
  '1777777777777',
  'Administrator Staged Name',
  '77777777-7777-4777-8777-777777777771',
  'USER',
  42,
  'ไทย (Thai)',
  false,
  true,
  encode(extensions.digest('1777777777777', 'sha256'), 'hex'),
  encode(extensions.digest('1777777777777', 'sha256'), 'hex')
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-4777-8777-777777777773',
  'authenticated',
  'authenticated',
  '1777777777777@safetypass.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

do $$
begin
  if has_function_privilege(
    'authenticated',
    'public.complete_registration(text,text,uuid,integer,text,text)',
    'EXECUTE'
  ) then raise exception 'Authenticated client can call legacy registration V1'; end if;

  if has_function_privilege(
    'authenticated',
    'public.complete_registration_v2(text,text,uuid,integer,text,text,text[],text,text,date,date)',
    'EXECUTE'
  ) then raise exception 'Authenticated client can call legacy registration V2'; end if;

  if has_function_privilege(
    'authenticated',
    'public.complete_registration_v3(text,text,uuid,integer,text,text,text[],text,text,date,date)',
    'EXECUTE'
  ) then raise exception 'Authenticated client can bypass staged-value preservation'; end if;

  if not has_function_privilege(
    'authenticated',
    'public.complete_registration_v4(text,text,uuid,integer,text,text,text[],text,text,date,date)',
    'EXECUTE'
  ) then raise exception 'Authenticated client cannot complete V4 registration'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777773', true);
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777773","role":"authenticated"}', true);

do $$
declare
  profile jsonb;
begin
  profile := public.get_my_staged_registration_profile();
  if profile ->> 'name' is distinct from 'Administrator Staged Name'
     or (profile ->> 'age')::integer <> 42
     or profile ->> 'vendor_id' is distinct from '77777777-7777-4777-8777-777777777771' then
    raise exception 'Authenticated staged profile returned unexpected data: %', profile;
  end if;
end;
$$;

select public.complete_registration_v4(
  '1777777777777',
  'Client Override Name',
  null,
  18,
  'ลาว (Lao)',
  'Client Override Vendor',
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
    where id = '77777777-7777-4777-8777-777777777773'
      and name = 'Administrator Staged Name'
      and vendor_id = '77777777-7777-4777-8777-777777777771'
      and age = 42
      and nationality = 'ไทย (Thai)'
      and pdpa_agreed = true
  ) then raise exception 'Staged administrator values were not preserved during registration'; end if;

  if exists (
    select 1 from public.users where id = '77777777-7777-4777-8777-777777777772'
  ) then raise exception 'Staged placeholder was not merged into the authenticated profile'; end if;
end;
$$;

-- A privileged staged row must never be claimable through the public
-- registration flow, even when the synthetic Auth identity already exists.
insert into public.users(
  id, national_id, name, vendor_id, role, age, nationality,
  pdpa_agreed, is_active, national_id_hash, national_id_fingerprint
) values (
  '77777777-7777-4777-8777-777777777774',
  '1777777777778',
  'Privileged Staged Account',
  '77777777-7777-4777-8777-777777777771',
  'ADMIN',
  35,
  'ไทย (Thai)',
  false,
  true,
  encode(extensions.digest('1777777777778', 'sha256'), 'hex'),
  encode(extensions.digest('1777777777778', 'sha256'), 'hex')
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-4777-8777-777777777775',
  'authenticated',
  'authenticated',
  '1777777777778@safetypass.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777775', true);
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777775","role":"authenticated"}', true);

do $$
begin
  begin
    perform public.get_my_staged_registration_profile();
    raise exception 'Privileged staged profile was exposed';
  exception
    when others then
      if sqlerrm not like '%Privileged profiles require administrator activation%' then raise; end if;
  end;

  begin
    perform public.complete_registration_v4(
      '1777777777778', 'Claimed Admin', null, 35, 'ไทย (Thai)', null,
      array['CONTRACTOR']::text[], null, null, null, null
    );
    raise exception 'Privileged staged profile was claimable';
  exception
    when others then
      if sqlerrm not like '%Privileged profiles require administrator activation%' then raise; end if;
  end;
end;
$$;

reset role;

-- Invalid locked staged values fall back to valid user input instead of
-- creating an unresolvable registration dead-end.
insert into public.vendors(id, name, status)
values ('77777777-7777-4777-8777-777777777778', 'Rejected Staged Vendor', 'REJECTED');

insert into public.users(
  id, national_id, name, vendor_id, role, age, nationality,
  pdpa_agreed, is_active, national_id_hash, national_id_fingerprint
) values (
  '77777777-7777-4777-8777-777777777776',
  '1777777777779',
  'Invalid Value Staged User',
  '77777777-7777-4777-8777-777777777778',
  'USER',
  150,
  'ไทย (Thai)',
  false,
  true,
  encode(extensions.digest('1777777777779', 'sha256'), 'hex'),
  encode(extensions.digest('1777777777779', 'sha256'), 'hex')
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '77777777-7777-4777-8777-777777777777',
  'authenticated',
  'authenticated',
  '1777777777779@safetypass.com',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claims', '{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}', true);

select public.complete_registration_v4(
  '1777777777779',
  'Client Name',
  '77777777-7777-4777-8777-777777777771',
  36,
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
    where id = '77777777-7777-4777-8777-777777777777'
      and role = 'USER'
      and age = 36
      and vendor_id = '77777777-7777-4777-8777-777777777771'
      and pdpa_agreed = true
  ) then raise exception 'Invalid staged values did not fall back to valid registration input'; end if;
end;
$$;

rollback;
