begin;

alter table public.users add column induction_verification_token uuid not null default gen_random_uuid();
create unique index users_induction_verification_token_idx on public.users(induction_verification_token);
alter table public.work_permits add column verification_token uuid not null default gen_random_uuid();
create unique index work_permits_verification_token_idx on public.work_permits(verification_token);

create function public.verify_induction_pass_token(token_param uuid)
returns table(name text, vendor_name text, induction_expiry timestamptz, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.name, v.name, u.induction_expiry, coalesce(u.is_active, false)
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where u.induction_verification_token = token_param and u.induction_expiry is not null
$$;
revoke all on function public.verify_induction_pass_token(uuid) from public, anon, authenticated;
grant execute on function public.verify_induction_pass_token(uuid) to anon, authenticated, service_role;

create function public.verify_work_permit_token(token_param uuid)
returns table(name text, vendor_name text, permit_no text, expire_date timestamptz, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.name, v.name, p.permit_no, p.expire_date,
    coalesce(u.is_active, false) and p.status = 'ACTIVE' and p.expire_date > now()
  from public.work_permits p
  join public.users u on u.id = p.user_id
  left join public.vendors v on v.id = u.vendor_id
  where p.verification_token = token_param
$$;
revoke all on function public.verify_work_permit_token(uuid) from public, anon, authenticated;
grant execute on function public.verify_work_permit_token(uuid) to anon, authenticated, service_role;

-- Existing printed cards retain their lookup during the transition, but
-- induction lookups only identify records that actually had a pass issued.
create or replace function public.verify_induction_pass(national_id_param text)
returns table(name text, vendor_name text, masked_national_id text, induction_expiry timestamptz, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select u.name, v.name, public.mask_national_id(national_id_param), u.induction_expiry, coalesce(u.is_active, false)
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
    and u.induction_expiry is not null
$$;

commit;
