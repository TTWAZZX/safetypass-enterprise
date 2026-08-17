begin;

insert into public.users(
  id, national_id, name, role, pdpa_agreed, is_active, last_login,
  national_id_hash, national_id_fingerprint
) values
  ('a1700000-0000-4000-8000-000000000001', '1777777777701', 'Role Test Admin One', 'ADMIN', true, true, now(),
   encode(extensions.digest('1777777777701', 'sha256'), 'hex'), encode(extensions.digest('1777777777701', 'sha256'), 'hex')),
  ('a1700000-0000-4000-8000-000000000002', '1777777777702', 'Role Test Admin Two', 'ADMIN', true, true, now(),
   encode(extensions.digest('1777777777702', 'sha256'), 'hex'), encode(extensions.digest('1777777777702', 'sha256'), 'hex')),
  ('a1700000-0000-4000-8000-000000000003', '1777777777703', 'Role Test Registered User', 'USER', true, true, now(),
   encode(extensions.digest('1777777777703', 'sha256'), 'hex'), encode(extensions.digest('1777777777703', 'sha256'), 'hex')),
  ('a1700000-0000-4000-8000-000000000004', '1777777777704', 'Role Test Staged User', 'USER', false, true, null,
   encode(extensions.digest('1777777777704', 'sha256'), 'hex'), encode(extensions.digest('1777777777704', 'sha256'), 'hex'));

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1700000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1700000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select public.admin_set_user_role('a1700000-0000-4000-8000-000000000003', 'ADMIN');

do $$
begin
  if not exists (
    select 1 from public.users
    where id = 'a1700000-0000-4000-8000-000000000003' and role = 'ADMIN'
  ) then raise exception 'Registered user was not promoted'; end if;

  begin
    perform public.admin_set_user_role('a1700000-0000-4000-8000-000000000004', 'ADMIN');
    raise exception 'Staged user was unexpectedly promoted';
  exception
    when raise_exception then
      if sqlerrm = 'Staged user was unexpectedly promoted' then raise; end if;
  end;

  begin
    perform public.admin_set_user_role('a1700000-0000-4000-8000-000000000001', 'USER');
    raise exception 'Admin unexpectedly changed their own role';
  exception
    when raise_exception then
      if sqlerrm = 'Admin unexpectedly changed their own role' then raise; end if;
  end;
end
$$;

select public.admin_set_user_role('a1700000-0000-4000-8000-000000000002', 'USER');

do $$
begin
  if not exists (
    select 1 from public.audit_logs
    where target = 'users:a1700000-0000-4000-8000-000000000003'
      and details::jsonb -> 'changed_fields' ? 'role'
  ) then raise exception 'Role change audit was not generated'; end if;
end
$$;

reset role;
rollback;
