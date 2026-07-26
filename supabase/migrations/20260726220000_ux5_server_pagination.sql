-- Phase UX-5: server-side pagination and aggregate dashboard data.
-- Existing read RPCs are intentionally retained for backward-compatible exports.

create index if not exists exam_history_created_at_idx
  on public.exam_history (created_at desc);
create index if not exists exam_history_type_status_created_idx
  on public.exam_history (exam_type, status, created_at desc);
create index if not exists users_vendor_created_idx
  on public.users (vendor_id, created_at desc);
create index if not exists vendors_created_at_idx
  on public.vendors (created_at desc);
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);

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
        'national_id', u.national_id,
        'age', u.age,
        'nationality', u.nationality,
        'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
      ) end as users
    from public.exam_history h
    left join public.users u on u.id = h.user_id
    left join public.vendors v on v.id = u.vendor_id
    where (normalized_search is null
      or u.name ilike '%' || normalized_search || '%'
      or u.national_id ilike '%' || normalized_search || '%'
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
revoke all on function public.admin_get_exam_history_page(integer, integer, text, text, text, date) from public, anon;
grant execute on function public.admin_get_exam_history_page(integer, integer, text, text, text, date) to authenticated, service_role;

create or replace function public.admin_get_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  with exam_totals as (
    select
      count(*)::bigint as total,
      count(*) filter (where status = 'PASSED')::bigint as passed,
      count(*) filter (where status <> 'PASSED')::bigint as failed
    from public.exam_history
  ), type_rows as (
    select
      exam_type,
      count(*) filter (where status = 'PASSED')::bigint as passed,
      count(*) filter (where status <> 'PASSED')::bigint as failed
    from public.exam_history
    group by exam_type
  ), type_summary as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', replace(exam_type, '_', ' '),
      'Passed', passed,
      'Failed', failed
    ) order by exam_type), '[]'::jsonb) as data
    from type_rows
  ), daily_rows as (
    select created_at::date as activity_date, count(*)::bigint as exams
    from public.exam_history
    group by created_at::date
    order by activity_date desc
    limit 14
  ), daily_summary as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dateKey', activity_date,
      'name', to_char(activity_date, 'DD Mon'),
      'Exams', exams
    ) order by activity_date), '[]'::jsonb) as data
    from daily_rows
  ), vendor_rows as (
    select
      coalesce(v.name, 'EXTERNAL (ไม่มีสังกัด)') as vendor_name,
      count(*)::bigint as total,
      count(*) filter (where h.status = 'PASSED')::bigint as passed,
      count(*) filter (where h.status <> 'PASSED')::bigint as failed
    from public.exam_history h
    left join public.users u on u.id = h.user_id
    left join public.vendors v on v.id = u.vendor_id
    group by coalesce(v.name, 'EXTERNAL (ไม่มีสังกัด)')
    order by total desc
    limit 5
  ), vendor_summary as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', vendor_name,
      'total', total,
      'passed', passed,
      'failed', failed
    ) order by total desc), '[]'::jsonb) as data
    from vendor_rows
  ), user_summary as (
    select
      count(*) filter (where is_active = false)::bigint as suspended,
      count(*) filter (where is_active = true and induction_expiry is null)::bigint as no_cert,
      count(*) filter (where is_active = true and induction_expiry <= now())::bigint as expired,
      count(*) filter (where is_active = true and induction_expiry > now() and induction_expiry <= now() + interval '30 days')::bigint as expiring
    from public.users
  )
  select jsonb_build_object(
    'total', e.total,
    'passed', e.passed,
    'failed', e.failed,
    'suspended', u.suspended,
    'compliance', jsonb_build_object('noCert', u.no_cert, 'expired', u.expired, 'expiring', u.expiring),
    'barData', t.data,
    'trendData', d.data,
    'vendorData', v.data
  )
  into result
  from exam_totals e
  cross join user_summary u
  cross join type_summary t
  cross join daily_summary d
  cross join vendor_summary v;

  return result;
end;
$$;
revoke all on function public.admin_get_dashboard_summary() from public, anon;
grant execute on function public.admin_get_dashboard_summary() to authenticated, service_role;

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
        u.national_id,
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
        or u.national_id ilike '%' || normalized_search || '%')
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
revoke all on function public.admin_get_directory_page(text, integer, integer, text, text, text) from public, anon;
grant execute on function public.admin_get_directory_page(text, integer, integer, text, text, text) to authenticated, service_role;

