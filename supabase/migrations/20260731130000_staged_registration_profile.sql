-- Registration status remains public and privacy-safe. Personal profile fields
-- are available only after the matching synthetic auth identity has a session.
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

-- V4 is the only client-callable completion entry point. Values staged by an
-- administrator take precedence; missing staged values can still be completed
-- by the user. V3 remains the transactional implementation but is no longer
-- directly callable by an authenticated client.
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
    effective_name := coalesce(nullif(trim(source_user.name), ''), name_param);
    effective_vendor_id := coalesce(source_user.vendor_id, vendor_id_param);
    effective_age := coalesce(source_user.age, age_param);
    effective_nationality := coalesce(nullif(trim(source_user.nationality), ''), nationality_param);
    if source_user.vendor_id is not null then effective_other_vendor_name := null; end if;
  end if;

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

revoke all on function public.complete_registration(text, text, uuid, integer, text, text) from authenticated;
revoke all on function public.complete_registration_v2(text, text, uuid, integer, text, text, text[], text, text, date, date) from authenticated;
revoke all on function public.complete_registration_v3(text, text, uuid, integer, text, text, text[], text, text, date, date) from authenticated;
revoke all on function public.complete_registration_v4(text, text, uuid, integer, text, text, text[], text, text, date, date) from public, anon;
grant execute on function public.complete_registration_v4(text, text, uuid, integer, text, text, text[], text, text, date, date) to authenticated, service_role;
