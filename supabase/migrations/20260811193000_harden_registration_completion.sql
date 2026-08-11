begin;

-- Staged registration is a public account-claim flow. Privileged identities
-- must never be claimable with a national ID alone, and invalid staged values
-- must not trap a user in read-only fields that the completion RPC rejects.
create or replace function public.get_my_staged_registration_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  auth_user_id uuid := auth.uid();
  auth_email text;
  national_id_value text;
  national_hash text;
  staged_user public.users%rowtype;
  result_value jsonb;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;

  select lower(email) into auth_email
  from auth.users
  where id = auth_user_id;

  if auth_email !~ '^[0-9]{13}@safetypass[.]com$' then
    raise exception 'Authenticated identity is not eligible for registration';
  end if;

  national_id_value := split_part(auth_email, '@', 1);
  national_hash := encode(extensions.digest(national_id_value, 'sha256'), 'hex');

  select u.* into staged_user
  from public.users u
  where u.national_id_fingerprint = national_hash
    and not coalesce(u.pdpa_agreed, false)
  order by case when u.id <> auth_user_id then 0 else 1 end, u.created_at desc
  limit 1;

  if staged_user.id is null then return null; end if;
  if not coalesce(staged_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if staged_user.role is distinct from 'USER' then
    raise exception 'Privileged profiles require administrator activation';
  end if;

  select jsonb_build_object(
    'name', staged_user.name,
    'age', staged_user.age,
    'nationality', staged_user.nationality,
    'vendor_id', staged_user.vendor_id,
    'vendor', case when v.id is null then null else jsonb_build_object(
      'id', v.id,
      'name', v.name,
      'status', v.status
    ) end
  ) into result_value
  from (select 1) seed
  left join public.vendors v on v.id = staged_user.vendor_id;

  return result_value;
end;
$$;

revoke all on function public.get_my_staged_registration_profile() from public, anon;
grant execute on function public.get_my_staged_registration_profile() to authenticated, service_role;

create or replace function public.get_staged_auth_bootstrap_identity(search_id text)
returns table(user_id uuid, recoverable boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with registration_state as (
    select
      count(*) filter (where coalesce(u.pdpa_agreed, false)) as completed_count,
      count(*) filter (
        where not coalesce(u.pdpa_agreed, false)
          and coalesce(u.is_active, false)
          and u.role = 'USER'
      ) as staged_user_count
    from public.users u
    where search_id ~ '^[0-9]{13}$'
      and u.national_id_fingerprint = encode(extensions.digest(search_id, 'sha256'), 'hex')
  )
  select
    au.id,
    (
      state.completed_count = 0
      and (
        state.staged_user_count > 0
        or not exists (
          select 1
          from public.users u
          where u.national_id_fingerprint = encode(extensions.digest(search_id, 'sha256'), 'hex')
        )
      )
      and coalesce(au.raw_user_meta_data ->> 'password_scheme', '') = 'bootstrap-v2'
    ) as recoverable
  from auth.users au
  cross join registration_state state
  where search_id ~ '^[0-9]{13}$'
    and lower(au.email) = lower(search_id || '@safetypass.com')
  limit 1
$$;

revoke all on function public.get_staged_auth_bootstrap_identity(text)
from public, anon, authenticated;
grant execute on function public.get_staged_auth_bootstrap_identity(text)
to service_role;

create or replace function public.complete_registration_v4(
  national_id_param text,
  name_param text,
  vendor_id_param uuid default null,
  age_param integer default null,
  nationality_param text default 'ไทย (Thai)',
  other_vendor_name_param text default null,
  program_codes_param text[] default array['CONTRACTOR']::text[],
  participant_type_param text default null,
  work_type_param text default null,
  access_start_date_param date default null,
  access_end_date_param date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_user_id uuid := auth.uid();
  national_hash text;
  source_user public.users%rowtype;
  effective_name text := name_param;
  effective_vendor_id uuid := vendor_id_param;
  effective_age integer := age_param;
  effective_nationality text := nationality_param;
  effective_other_vendor_name text := other_vendor_name_param;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;

  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  select u.* into source_user
  from public.users u
  where u.national_id_fingerprint = national_hash
    and not coalesce(u.pdpa_agreed, false)
  order by case when u.id <> auth_user_id then 0 else 1 end, u.created_at desc
  limit 1 for update;

  if source_user.id is not null then
    if source_user.role is distinct from 'USER' then
      raise exception 'Privileged profiles require administrator activation';
    end if;
    effective_name := coalesce(nullif(trim(source_user.name), ''), name_param);
    if source_user.age between 1 and 120 then effective_age := source_user.age; end if;
    effective_nationality := coalesce(
      nullif(trim(source_user.nationality), ''),
      nationality_param
    );
    if source_user.vendor_id is not null and exists (
      select 1 from public.vendors v
      where v.id = source_user.vendor_id and v.status in ('APPROVED', 'PENDING')
    ) then
      effective_vendor_id := source_user.vendor_id;
      effective_other_vendor_name := null;
    end if;
  end if;

  if nullif(trim(effective_name), '') is null then raise exception 'Name is required'; end if;
  if effective_age is null or effective_age < 1 or effective_age > 120 then
    raise exception 'Invalid age';
  end if;
  if nullif(trim(effective_nationality), '') is null then raise exception 'Nationality is required'; end if;

  return public.complete_registration_v3(
    national_id_param,
    effective_name,
    effective_vendor_id,
    effective_age,
    effective_nationality,
    effective_other_vendor_name,
    program_codes_param,
    participant_type_param,
    work_type_param,
    access_start_date_param,
    access_end_date_param
  );
end;
$$;

revoke all on function public.complete_registration_v4(
  text, text, uuid, integer, text, text, text[], text, text, date, date
) from public, anon;
grant execute on function public.complete_registration_v4(
  text, text, uuid, integer, text, text, text[], text, text, date, date
) to authenticated, service_role;

commit;
