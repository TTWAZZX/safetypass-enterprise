create or replace function public.verify_induction_pass(national_id_param text)
returns table (
  name text,
  vendor_name text,
  masked_national_id text,
  induction_expiry timestamptz,
  is_active boolean
)
language sql
security definer
set search_path = public
as $$
  select
    u.name,
    v.name,
    case
      when length(u.national_id) = 13 then
        substring(u.national_id from 1 for 1) || '-' ||
        substring(u.national_id from 2 for 4) || '-XXXXX-' ||
        substring(u.national_id from 11 for 2) || '-' ||
        substring(u.national_id from 13 for 1)
      else 'REDACTED'
    end,
    u.induction_expiry,
    coalesce(u.is_active, false)
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id = national_id_param
  limit 1;
$$;

revoke all on function public.verify_induction_pass(text) from public;
grant execute on function public.verify_induction_pass(text) to anon, authenticated;
