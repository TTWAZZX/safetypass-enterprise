begin;

set local role anon;
do $$
declare
  vendor_count integer;
begin
  select count(*) into vendor_count
  from public.get_public_registration_vendors();
  if vendor_count < 1 then
    raise exception 'Public registration vendor RPC returned no approved companies';
  end if;
  if exists (
    select 1 from public.get_public_registration_vendors()
    where status <> 'APPROVED'
  ) then
    raise exception 'Public registration vendor RPC exposed a non-approved company';
  end if;
  begin
    perform 1 from public.vendors limit 1;
    raise exception 'Anonymous direct vendor table access is still available';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
