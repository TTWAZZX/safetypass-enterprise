begin;

insert into public.users(
  id, national_id, name, role, pdpa_agreed, is_active,
  national_id_hash, national_id_fingerprint
) values
  ('a1800000-0000-4000-8000-000000000001', '1888888888801', 'Training Guard Admin', 'ADMIN', true, true,
   encode(extensions.digest('1888888888801', 'sha256'), 'hex'), encode(extensions.digest('1888888888801', 'sha256'), 'hex')),
  ('a1800000-0000-4000-8000-000000000002', '1888888888802', 'Contractor Only User', 'USER', true, true,
   encode(extensions.digest('1888888888802', 'sha256'), 'hex'), encode(extensions.digest('1888888888802', 'sha256'), 'hex')),
  ('a1800000-0000-4000-8000-000000000003', '1888888888803', 'Dual Program User', 'USER', true, true,
   encode(extensions.digest('1888888888803', 'sha256'), 'hex'), encode(extensions.digest('1888888888803', 'sha256'), 'hex'));

insert into public.user_training_access(user_id, program_code)
values
  ('a1800000-0000-4000-8000-000000000001', 'CONTRACTOR'),
  ('a1800000-0000-4000-8000-000000000002', 'CONTRACTOR'),
  ('a1800000-0000-4000-8000-000000000003', 'CONTRACTOR');

insert into public.user_training_access(
  user_id, program_code, participant_type, work_type
) values (
  'a1800000-0000-4000-8000-000000000003', 'SUPPLIER_OUTSOURCE', 'supplier', 'Driver'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

do $$
begin
  begin
    perform public.admin_set_training_access(
      'a1800000-0000-4000-8000-000000000002', 'CONTRACTOR', false, null, null
    );
    raise exception 'Last program was unexpectedly removed';
  exception
    when raise_exception then
      if sqlerrm = 'Last program was unexpectedly removed' then raise; end if;
      if sqlerrm <> 'Active users must have at least one training program' then raise; end if;
  end;

  perform public.admin_set_training_access(
    'a1800000-0000-4000-8000-000000000003', 'CONTRACTOR', false, null, null
  );

  if exists (
    select 1 from public.user_training_access
    where user_id = 'a1800000-0000-4000-8000-000000000003'
      and program_code = 'CONTRACTOR'
  ) then raise exception 'Contractor program was not removed from a dual-program user'; end if;

  if not exists (
    select 1 from public.user_training_access
    where user_id = 'a1800000-0000-4000-8000-000000000003'
      and program_code = 'SUPPLIER_OUTSOURCE'
  ) then raise exception 'Replacement Supplier program was changed'; end if;
end
$$;

reset role;

insert into public.work_permits(user_id, permit_no, expire_date, status)
values (
  'a1800000-0000-4000-8000-000000000002', '1818181818', now() + interval '1 day', 'ACTIVE'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.admin_set_training_access(
  'a1800000-0000-4000-8000-000000000002',
  'SUPPLIER_OUTSOURCE', true, 'outsource', 'Passenger'
);

do $$
begin
  begin
    perform public.admin_set_training_access(
      'a1800000-0000-4000-8000-000000000002', 'CONTRACTOR', false, null, null
    );
    raise exception 'Contractor access with an active permit was unexpectedly removed';
  exception
    when raise_exception then
      if sqlerrm = 'Contractor access with an active permit was unexpectedly removed' then raise; end if;
      if sqlerrm <> 'Active Work Permit must be revoked or expired before removing Contractor access' then raise; end if;
  end;
end
$$;

reset role;

update public.work_permits
set status = 'EXPIRED'
where user_id = 'a1800000-0000-4000-8000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1800000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1800000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.admin_set_training_access(
  'a1800000-0000-4000-8000-000000000002', 'CONTRACTOR', false, null, null
);

do $$
begin
  if not exists (
    select 1 from public.work_permits
    where user_id = 'a1800000-0000-4000-8000-000000000002'
      and permit_no = '1818181818'
  ) then raise exception 'Work Permit history was deleted'; end if;

  begin
    perform public.admin_set_supplier_outsource_access(
      'a1800000-0000-4000-8000-000000000002', false, null, null, null, null
    );
    raise exception 'Last Supplier program was unexpectedly removed';
  exception
    when raise_exception then
      if sqlerrm = 'Last Supplier program was unexpectedly removed' then raise; end if;
      if sqlerrm <> 'Active users must have at least one training program' then raise; end if;
  end;
end
$$;

reset role;

-- Service-role/direct SQL paths are also protected by the deferred invariant.
do $$
begin
  begin
    delete from public.user_training_access
    where user_id = 'a1800000-0000-4000-8000-000000000003';
    set constraints trg_require_active_user_training_access immediate;
    raise exception 'Deferred last-program guard did not run';
  exception
    when raise_exception then
      if sqlerrm = 'Deferred last-program guard did not run' then raise; end if;
      if sqlerrm <> 'Active users must have at least one training program' then raise; end if;
  end;

  if not exists (
    select 1 from public.user_training_access
    where user_id = 'a1800000-0000-4000-8000-000000000003'
      and program_code = 'SUPPLIER_OUTSOURCE'
  ) then raise exception 'Deferred guard did not restore the last program'; end if;
end
$$;

insert into public.users(
  id, national_id, name, role, pdpa_agreed, is_active,
  national_id_hash, national_id_fingerprint
) values (
  'a1800000-0000-4000-8000-000000000004', '1888888888804',
  'Inactive User Without Program', 'USER', true, false,
  encode(extensions.digest('1888888888804', 'sha256'), 'hex'),
  encode(extensions.digest('1888888888804', 'sha256'), 'hex')
);

do $$
begin
  begin
    update public.users
    set is_active = true
    where id = 'a1800000-0000-4000-8000-000000000004';
    set constraints trg_require_training_access_on_user_activation immediate;
    raise exception 'User without a program was unexpectedly activated';
  exception
    when raise_exception then
      if sqlerrm = 'User without a program was unexpectedly activated' then raise; end if;
      if sqlerrm <> 'Active users must have at least one training program' then raise; end if;
  end;
end
$$;

rollback;
