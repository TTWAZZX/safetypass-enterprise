begin;

create extension if not exists pg_trgm with schema extensions;

create or replace function public.normalize_vendor_name(input_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(input_name, '')), '[[:space:][:punct:]]+', '', 'g'))
$$;

revoke all on function public.normalize_vendor_name(text) from public, anon;
grant execute on function public.normalize_vendor_name(text) to authenticated, service_role;

alter table public.vendors add column if not exists normalized_name text;
update public.vendors
set normalized_name = public.normalize_vendor_name(name)
where normalized_name is distinct from public.normalize_vendor_name(name);

create index if not exists vendors_normalized_name_idx
  on public.vendors (normalized_name);

create or replace function public.guard_vendor_name_duplicates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vendor_key text;
  duplicate_record public.vendors%rowtype;
begin
  new.name := regexp_replace(btrim(coalesce(new.name, '')), '[[:space:]]+', ' ', 'g');
  vendor_key := public.normalize_vendor_name(new.name);
  if vendor_key = '' then raise exception 'Vendor name is required'; end if;
  new.normalized_name := vendor_key;

  if tg_op = 'UPDATE' then
    if vendor_key = coalesce(old.normalized_name, public.normalize_vendor_name(old.name)) then
      return new;
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(vendor_key, 0));
  select * into duplicate_record
  from public.vendors v
  where v.normalized_name = vendor_key
    and (tg_op = 'INSERT' or v.id <> new.id)
  order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end,
           v.created_at,
           v.id
  limit 1;

  if duplicate_record.id is not null then
    raise exception using
      errcode = '23505',
      message = format('DUPLICATE_VENDOR_NAME:%s:%s', duplicate_record.id, duplicate_record.name);
  end if;
  return new;
end;
$$;

revoke all on function public.guard_vendor_name_duplicates() from public, anon, authenticated;
drop trigger if exists vendors_name_duplicate_guard on public.vendors;
create trigger vendors_name_duplicate_guard
before insert or update of name on public.vendors
for each row execute function public.guard_vendor_name_duplicates();

create or replace function public.find_vendor_name_matches(
  search_name_param text,
  exclude_vendor_id_param uuid default null,
  limit_param integer default 5
)
returns table(
  id uuid,
  name text,
  status text,
  match_type text,
  match_score numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  search_key text := public.normalize_vendor_name(search_name_param);
  safe_limit integer := greatest(1, least(coalesce(limit_param, 5), 10));
begin
  if length(search_key) < 2 then return; end if;

  return query
  with scored as (
    select
      v.id,
      v.name,
      v.status,
      case when v.normalized_name = search_key then 'EXACT' else 'SIMILAR' end as match_type,
      case
        when v.normalized_name = search_key then 1::numeric
        else greatest(
          extensions.similarity(v.normalized_name, search_key)::numeric,
          case when position(search_key in v.normalized_name) > 0
                 or position(v.normalized_name in search_key) > 0 then 0.78::numeric else 0::numeric end
        )
      end as match_score
    from public.vendors v
    where (exclude_vendor_id_param is null or v.id <> exclude_vendor_id_param)
      and (public.is_admin() or v.status <> 'REJECTED' or v.normalized_name = search_key)
  )
  select s.id, s.name, s.status, s.match_type, round(s.match_score, 3)
  from scored s
  where s.match_score >= 0.34
  order by case s.match_type when 'EXACT' then 0 else 1 end,
           s.match_score desc,
           case s.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end,
           s.name
  limit safe_limit;
end;
$$;

revoke all on function public.find_vendor_name_matches(text, uuid, integer) from public;
grant execute on function public.find_vendor_name_matches(text, uuid, integer) to anon, authenticated, service_role;

create or replace function public.admin_save_vendor(
  vendor_id_param uuid,
  name_param text,
  status_param text default 'PENDING',
  allow_similar_param boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  vendor_key text := public.normalize_vendor_name(name_param);
  existing_vendor public.vendors%rowtype;
  original_vendor public.vendors%rowtype;
  saved_vendor public.vendors%rowtype;
  similar_matches jsonb := '[]'::jsonb;
  created_value boolean := false;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if vendor_key = '' then raise exception 'Vendor name is required'; end if;
  if status_param not in ('PENDING', 'APPROVED', 'REJECTED') then raise exception 'Invalid vendor status'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(vendor_key, 0));
  if vendor_id_param is not null then
    select * into original_vendor
    from public.vendors v
    where v.id = vendor_id_param
    for update;
    if original_vendor.id is null then raise exception 'Vendor not found'; end if;

    if vendor_key = coalesce(original_vendor.normalized_name, public.normalize_vendor_name(original_vendor.name)) then
      update public.vendors
      set name = name_param, status = status_param
      where id = vendor_id_param
      returning * into saved_vendor;
      return jsonb_build_object(
        'saved', true,
        'created', false,
        'reason', 'SAVED',
        'vendor', jsonb_build_object('id', saved_vendor.id, 'name', saved_vendor.name, 'status', saved_vendor.status),
        'matches', '[]'::jsonb
      );
    end if;
  end if;

  select * into existing_vendor
  from public.vendors v
  where v.normalized_name = vendor_key
    and (vendor_id_param is null or v.id <> vendor_id_param)
  order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end,
           v.created_at,
           v.id
  limit 1;

  if existing_vendor.id is not null then
    return jsonb_build_object(
      'saved', false,
      'created', false,
      'reason', 'EXACT',
      'vendor', jsonb_build_object('id', existing_vendor.id, 'name', existing_vendor.name, 'status', existing_vendor.status),
      'matches', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'name', m.name, 'status', m.status,
    'match_type', m.match_type, 'match_score', m.match_score
  ) order by m.match_score desc), '[]'::jsonb)
  into similar_matches
  from public.find_vendor_name_matches(name_param, vendor_id_param, 5) m
  where m.match_type = 'SIMILAR';

  if not coalesce(allow_similar_param, false) and jsonb_array_length(similar_matches) > 0 then
    return jsonb_build_object(
      'saved', false,
      'created', false,
      'reason', 'SIMILAR',
      'vendor', null,
      'matches', similar_matches
    );
  end if;

  if vendor_id_param is null then
    insert into public.vendors(name, status)
    values (name_param, status_param)
    returning * into saved_vendor;
    created_value := true;
  else
    update public.vendors
    set name = name_param, status = status_param
    where id = vendor_id_param
    returning * into saved_vendor;
    if saved_vendor.id is null then raise exception 'Vendor not found'; end if;
  end if;

  return jsonb_build_object(
    'saved', true,
    'created', created_value,
    'reason', 'SAVED',
    'vendor', jsonb_build_object('id', saved_vendor.id, 'name', saved_vendor.name, 'status', saved_vendor.status),
    'matches', similar_matches
  );
end;
$$;

revoke all on function public.admin_save_vendor(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_save_vendor(uuid, text, text, boolean) to authenticated, service_role;

create or replace function public.admin_get_vendor_duplicate_groups()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result_value jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  select coalesce(jsonb_agg(to_jsonb(groups) order by groups.vendor_count desc, groups.normalized_name), '[]'::jsonb)
  into result_value
  from (
    select
      v.normalized_name,
      count(*)::integer as vendor_count,
      jsonb_agg(jsonb_build_object(
        'id', v.id, 'name', v.name, 'status', v.status, 'created_at', v.created_at
      ) order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end, v.created_at) as vendors
    from public.vendors v
    where v.normalized_name <> ''
    group by v.normalized_name
    having count(*) > 1
  ) groups;
  return result_value;
end;
$$;

revoke all on function public.admin_get_vendor_duplicate_groups() from public, anon;
grant execute on function public.admin_get_vendor_duplicate_groups() to authenticated, service_role;

create or replace function public.complete_registration_v3(
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
  auth_email text;
  national_hash text;
  linked_user public.users%rowtype;
  staged_user public.users%rowtype;
  final_vendor_id uuid := vendor_id_param;
  matched_vendor public.vendors%rowtype;
  result_value jsonb;
  enabled_value boolean;
  vendor_request_created boolean := false;
  vendor_resolution text := 'SELECTED';
  other_vendor_key text;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if nullif(trim(name_param), '') is null then raise exception 'Name is required'; end if;
  if age_param is not null and (age_param < 0 or age_param > 120) then raise exception 'Invalid age'; end if;
  if program_codes_param is null or cardinality(program_codes_param) = 0 then raise exception 'At least one program is required'; end if;
  if exists (select 1 from unnest(program_codes_param) p where p not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')) then
    raise exception 'Invalid program code';
  end if;

  select coalesce(sc.value::boolean, false) into enabled_value
  from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if 'SUPPLIER_OUTSOURCE' = any(program_codes_param) then
    if not coalesce(enabled_value, false) then raise exception 'Program registration is not enabled'; end if;
    if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;
  end if;

  select lower(email) into auth_email from auth.users where id = auth_user_id;
  if auth_email is distinct from lower(national_id_param || '@safetypass.com') then
    raise exception 'Authenticated identity does not match registration';
  end if;

  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  select * into linked_user from public.users where id = auth_user_id for update;
  select * into staged_user from public.users
  where id <> auth_user_id and national_id_fingerprint = national_hash
    and not coalesce(pdpa_agreed, false)
  order by created_at desc limit 1 for update;

  if linked_user.id is not null and coalesce(linked_user.pdpa_agreed, false) then raise exception 'Account is already registered'; end if;
  if linked_user.id is not null and linked_user.national_id_fingerprint is distinct from national_hash then raise exception 'Authenticated profile does not match registration'; end if;
  if linked_user.id is not null and not coalesce(linked_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if staged_user.id is not null and not coalesce(staged_user.is_active, false) then raise exception 'Account is suspended'; end if;

  if nullif(trim(other_vendor_name_param), '') is not null then
    other_vendor_key := public.normalize_vendor_name(other_vendor_name_param);
    if other_vendor_key = '' then raise exception 'Vendor name is required'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(other_vendor_key, 0));
    select * into matched_vendor
    from public.vendors v
    where v.normalized_name = other_vendor_key
    order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end, v.created_at, v.id
    limit 1;

    if matched_vendor.id is not null then
      if matched_vendor.status = 'REJECTED' then raise exception 'Vendor name is unavailable. Please contact administrator'; end if;
      final_vendor_id := matched_vendor.id;
      vendor_resolution := case matched_vendor.status when 'APPROVED' then 'EXISTING_APPROVED' else 'EXISTING_PENDING' end;
    else
      insert into public.vendors(name, status)
      values (other_vendor_name_param, 'PENDING')
      returning id into final_vendor_id;
      vendor_request_created := true;
      vendor_resolution := 'CREATED_PENDING';
    end if;
  elsif final_vendor_id is not null and not exists (
    select 1 from public.vendors where id = final_vendor_id and status in ('APPROVED', 'PENDING')
  ) then raise exception 'Selected vendor is unavailable';
  end if;

  if linked_user.id is null then
    if staged_user.id is not null then
      update public.users set national_id_hash = null, national_id_fingerprint = null, national_id_cipher = null
      where id = staged_user.id;
    end if;
    insert into public.users(
      id, national_id, name, vendor_id, role, induction_expiry, age, nationality,
      pdpa_agreed, pdpa_agreed_at, is_active, date_of_birth, avatar_url,
      national_id_hash, national_id_fingerprint
    ) values (
      auth_user_id, national_id_param, trim(name_param), final_vendor_id,
      coalesce(staged_user.role, 'USER'), staged_user.induction_expiry, age_param,
      coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'), true, now(), true,
      staged_user.date_of_birth, staged_user.avatar_url, national_hash, national_hash
    );
  else
    update public.users set name = trim(name_param), vendor_id = final_vendor_id, age = age_param,
      nationality = coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'),
      pdpa_agreed = true, pdpa_agreed_at = now()
    where id = auth_user_id;
  end if;

  if staged_user.id is not null then
    update public.exam_history set user_id = auth_user_id where user_id = staged_user.id;
    update public.exam_logs set user_id = auth_user_id where user_id = staged_user.id;
    update public.work_permits set user_id = auth_user_id where user_id = staged_user.id;
    delete from public.users where id = staged_user.id;
  end if;

  delete from public.user_training_access
  where user_id = auth_user_id and program_code not in (select unnest(program_codes_param));
  if 'CONTRACTOR' = any(program_codes_param) then
    insert into public.user_training_access(user_id, program_code)
    values (auth_user_id, 'CONTRACTOR') on conflict (user_id, program_code) do nothing;
  end if;
  if 'SUPPLIER_OUTSOURCE' = any(program_codes_param) then
    insert into public.user_training_access(
      user_id, program_code, participant_type, work_type, access_start_date, access_end_date
    ) values (
      auth_user_id, 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
      access_start_date_param, access_end_date_param
    ) on conflict (user_id, program_code) do update
      set participant_type = excluded.participant_type, work_type = excluded.work_type,
          access_start_date = excluded.access_start_date, access_end_date = excluded.access_end_date,
          updated_at = now();
  end if;

  select jsonb_build_object(
    'id', u.id, 'national_id', national_id_param, 'name', u.name, 'vendor_id', u.vendor_id,
    'role', u.role, 'induction_expiry', u.induction_expiry, 'created_at', u.created_at,
    'age', u.age, 'nationality', u.nationality, 'pdpa_agreed', u.pdpa_agreed,
    'is_active', u.is_active, 'date_of_birth', u.date_of_birth, 'avatar_url', u.avatar_url,
    'last_login', u.last_login, 'vendor_request_created', vendor_request_created,
    'vendor_resolution', vendor_resolution,
    'vendors', case when v.id is null then null else jsonb_build_object('name', v.name, 'status', v.status) end
  ) into result_value
  from public.users u left join public.vendors v on v.id = u.vendor_id where u.id = auth_user_id;
  return result_value;
end;
$$;

revoke all on function public.complete_registration_v3(text, text, uuid, integer, text, text, text[], text, text, date, date) from public, anon;
grant execute on function public.complete_registration_v3(text, text, uuid, integer, text, text, text[], text, text, date, date) to authenticated, service_role;

commit;
