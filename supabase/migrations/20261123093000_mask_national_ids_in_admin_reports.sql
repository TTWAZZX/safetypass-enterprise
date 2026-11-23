begin;

create or replace function public.admin_list_users()
returns table(
  id uuid,
  national_id text,
  name text,
  vendor_id uuid,
  role text,
  induction_expiry timestamptz,
  created_at timestamptz,
  age integer,
  nationality text,
  pdpa_agreed boolean,
  is_active boolean,
  date_of_birth date,
  avatar_url text,
  last_login timestamptz,
  vendors jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    u.id,
    public.mask_national_id(u.national_id),
    u.name,
    u.vendor_id,
    u.role,
    u.induction_expiry,
    u.created_at,
    u.age,
    u.nationality,
    u.pdpa_agreed,
    u.is_active,
    u.date_of_birth,
    u.avatar_url,
    u.last_login,
    case when v.id is null then null else jsonb_build_object('name', v.name) end
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_get_exam_history()
returns table(
  id uuid,
  user_id uuid,
  exam_type text,
  score integer,
  total_questions integer,
  status text,
  created_at timestamptz,
  users jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    h.id, h.user_id, h.exam_type, h.score, h.total_questions, h.status, h.created_at,
    case when u.id is null then null else jsonb_build_object(
      'name', u.name,
      'national_id', public.mask_national_id(u.national_id),
      'age', u.age,
      'nationality', u.nationality,
      'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
    ) end
  from public.exam_history h
  left join public.users u on u.id = h.user_id
  left join public.vendors v on v.id = u.vendor_id
  order by h.created_at desc;
end;
$$;

create or replace function public.admin_get_exam_history_page(
  p_page integer default 1,
  p_page_size integer default 10,
  p_search text default null,
  p_exam_type text default null,
  p_status text default null,
  p_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 5000);
  normalized_search text := nullif(btrim(coalesce(p_search, '')), '');
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  with filtered as materialized (
    select
      h.id,
      h.user_id,
      h.exam_type,
      h.score,
      h.total_questions,
      h.status,
      h.created_at,
      case when u.id is null then null else jsonb_build_object(
        'name', u.name,
        'national_id', public.mask_national_id(u.national_id),
        'age', u.age,
        'nationality', u.nationality,
        'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
      ) end as users
    from public.exam_history h
    left join public.users u on u.id = h.user_id
    left join public.vendors v on v.id = u.vendor_id
    where (normalized_search is null
      or u.name ilike '%' || normalized_search || '%'
      or u.national_id = normalized_search
      or public.mask_national_id(u.national_id) ilike '%' || normalized_search || '%'
      or v.name ilike '%' || normalized_search || '%')
      and (p_exam_type is null or p_exam_type = 'ALL' or h.exam_type = p_exam_type)
      and (p_status is null or p_status = 'ALL' or h.status = p_status)
      and (p_date is null or (h.created_at >= p_date and h.created_at < p_date + interval '1 day'))
  ), page_rows as (
    select *
    from filtered
    order by created_at desc
    limit safe_page_size
    offset (safe_page - 1) * safe_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc) from page_rows), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', safe_page,
    'page_size', safe_page_size
  ) into result;

  return result;
end;
$$;

create or replace function public.admin_get_directory_page(
  p_section text,
  p_page integer default 1,
  p_page_size integer default 10,
  p_search text default null,
  p_vendor_filter text default null,
  p_cert_filter text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_section text := upper(coalesce(p_section, ''));
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 5000);
  normalized_search text := nullif(btrim(coalesce(p_search, '')), '');
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  if safe_section = 'USERS' then
    with filtered as materialized (
      select
        u.id,
        public.mask_national_id(u.national_id) as national_id,
        u.name,
        u.vendor_id,
        u.role,
        u.induction_expiry,
        u.created_at,
        u.age,
        u.nationality,
        u.pdpa_agreed,
        u.is_active,
        u.date_of_birth,
        u.avatar_url,
        u.last_login,
        case when v.id is null then null else jsonb_build_object('name', v.name) end as vendors,
        case
          when (u.induction_expiry is null or u.induction_expiry <= now()) and u.last_login is not null then 0
          when (u.induction_expiry is null or u.induction_expiry <= now()) then 1
          when u.induction_expiry <= now() + interval '30 days' then 2
          else 3
        end as sort_order
      from public.users u
      left join public.vendors v on v.id = u.vendor_id
      where (normalized_search is null
        or u.name ilike '%' || normalized_search || '%'
        or u.national_id = normalized_search
        or public.mask_national_id(u.national_id) ilike '%' || normalized_search || '%')
        and (p_vendor_filter is null or p_vendor_filter = ''
          or (p_vendor_filter = 'EXTERNAL' and u.vendor_id is null)
          or (p_vendor_filter <> 'EXTERNAL' and u.vendor_id::text = p_vendor_filter))
        and (p_cert_filter is null or p_cert_filter = ''
          or (p_cert_filter = 'NO_CERT' and (u.induction_expiry is null or u.induction_expiry <= now()))
          or (p_cert_filter = 'EXPIRING' and u.induction_expiry > now() and u.induction_expiry <= now() + interval '30 days')
          or (p_cert_filter = 'HAS_CERT' and u.induction_expiry > now() + interval '30 days'))
    ), page_rows as (
      select * from filtered
      order by sort_order, created_at desc
      limit safe_page_size offset (safe_page - 1) * safe_page_size
    ), stats as (
      select jsonb_build_object(
        'total', count(*),
        'noCert', count(*) filter (where induction_expiry is null),
        'expired', count(*) filter (where induction_expiry is not null and induction_expiry <= now()),
        'expiring', count(*) filter (where induction_expiry > now() and induction_expiry <= now() + interval '30 days'),
        'valid', count(*) filter (where induction_expiry > now() + interval '30 days')
      ) as data from public.users
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) - 'sort_order' order by sort_order, created_at desc) from page_rows), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'stats', (select data from stats)
    ) into result;
  elsif safe_section = 'VENDORS' then
    with filtered as materialized (
      select v.id, v.name, v.status, v.created_at
      from public.vendors v
      where normalized_search is null or v.name ilike '%' || normalized_search || '%'
    ), page_rows as (
      select * from filtered order by created_at desc
      limit safe_page_size offset (safe_page - 1) * safe_page_size
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc) from page_rows), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'stats', null
    ) into result;
  elsif safe_section = 'LOGS' then
    with filtered as materialized (
      select l.* from public.audit_logs l
    ), page_rows as (
      select * from filtered order by created_at desc
      limit safe_page_size offset (safe_page - 1) * safe_page_size
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc) from page_rows), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'stats', null
    ) into result;
  else
    raise exception 'Unsupported directory section';
  end if;

  return result || jsonb_build_object('page', safe_page, 'page_size', safe_page_size);
end;
$$;

create or replace function public.admin_supplier_outsource_report()
returns table(
  user_id uuid, company text, name text, participant_type text, work_type text,
  national_id text, test_date timestamptz, expiration_date timestamptz,
  score integer, total_questions integer, result_status text,
  access_start_date date, access_end_date date, verification_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select u.id, coalesce(v.name, '-'), u.name, a.participant_type, a.work_type,
    case
      when u.national_id ~ '^[0-9]{13}$' then public.mask_national_id(u.national_id)
      when au.email ~ '^[0-9]{13}@safetypass[.]com$' then public.mask_national_id(split_part(au.email, '@', 1))
      else null
    end,
    coalesce(pass_result.test_date, latest_result.test_date),
    coalesce(pass_result.expires_at, a.expires_at),
    coalesce(pass_result.score, latest_result.score),
    coalesce(pass_result.total_questions, latest_result.total_questions),
    coalesce(pass_result.status, latest_result.status),
    a.access_start_date, a.access_end_date, pass_result.verification_token
  from public.user_training_access a
  join public.users u on u.id = a.user_id
  left join auth.users au on au.id = u.id
  left join public.vendors v on v.id = u.vendor_id
  left join lateral (
    select p.verification_token, p.expires_at, h.score, h.total_questions,
      h.status, h.created_at as test_date
    from public.supplier_outsource_passes p
    join public.exam_history h on h.id = p.exam_history_id
    where p.user_id = a.user_id and p.status = 'ACTIVE'
    order by p.issued_at desc
    limit 1
  ) pass_result on true
  left join lateral (
    select h.score, h.total_questions, h.status, h.created_at as test_date
    from public.exam_history h
    where h.user_id = a.user_id and h.exam_type = 'SUPPLIER_OUTSOURCE'
    order by h.created_at desc
    limit 1
  ) latest_result on true
  where a.program_code = 'SUPPLIER_OUTSOURCE'
  order by coalesce(pass_result.test_date, latest_result.test_date, a.created_at) desc;
end;
$$;

commit;
