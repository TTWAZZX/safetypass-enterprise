--
-- PostgreSQL database dump
--

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: add_my_supplier_outsource_access(text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_my_supplier_outsource_access(participant_type_param text, work_type_param text, access_start_date_param date DEFAULT NULL::date, access_end_date_param date DEFAULT NULL::date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  enabled_value boolean;
  current_access public.user_training_access%rowtype;
  access_changed boolean := false;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.users where id = auth.uid() and coalesce(is_active, false)) then
    raise exception 'Account is unavailable';
  end if;
  select coalesce(sc.value::boolean, false) into enabled_value
  from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if not coalesce(enabled_value, false) then raise exception 'Program registration is not enabled'; end if;
  if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
  if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
  if access_end_date_param is not null and access_start_date_param is not null
     and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;

  select * into current_access
  from public.user_training_access
  where user_id = auth.uid() and program_code = 'SUPPLIER_OUTSOURCE'
  for update;

  if found then
    access_changed := current_access.participant_type is distinct from participant_type_param
      or current_access.work_type is distinct from work_type_param
      or current_access.access_start_date is distinct from access_start_date_param
      or current_access.access_end_date is distinct from access_end_date_param;

    if access_changed then
      update public.supplier_outsource_passes
      set status = 'REVOKED'
      where user_id = auth.uid() and status = 'ACTIVE';
    end if;

    update public.user_training_access
    set participant_type = participant_type_param,
        work_type = work_type_param,
        access_start_date = access_start_date_param,
        access_end_date = access_end_date_param,
        passed_at = case when access_changed then null else passed_at end,
        expires_at = case when access_changed then null else expires_at end,
        updated_at = now()
    where user_id = current_access.user_id
      and program_code = current_access.program_code;
  else
    insert into public.user_training_access(
      user_id, program_code, participant_type, work_type, access_start_date, access_end_date
    ) values (
      auth.uid(), 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
      access_start_date_param, access_end_date_param
    );
  end if;
end;
$$;


--
-- Name: add_my_training_access(text[], text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_my_training_access(program_codes text[], participant_type_param text DEFAULT NULL::text, work_type_param text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  program_value text;
  enabled_value boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select coalesce(sc.value::boolean, false) into enabled_value
  from public.system_config sc
  where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if not coalesce(enabled_value, false) then raise exception 'Program registration is not enabled'; end if;

  if program_codes is null or cardinality(program_codes) = 0 then
    raise exception 'At least one program is required';
  end if;
  if exists (select 1 from unnest(program_codes) p where p not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')) then
    raise exception 'Invalid program code';
  end if;
  if participant_type_param is not null and participant_type_param not in ('supplier', 'outsource') then
    raise exception 'Invalid participant type';
  end if;
  if work_type_param is not null and work_type_param not in ('Driver', 'Passenger', 'Trainee') then
    raise exception 'Invalid work type';
  end if;

  foreach program_value in array program_codes loop
    insert into public.user_training_access(user_id, program_code, participant_type, work_type)
    values (
      auth.uid(),
      program_value,
      case when program_value = 'SUPPLIER_OUTSOURCE' then participant_type_param else null end,
      case when program_value = 'SUPPLIER_OUTSOURCE' then work_type_param else null end
    )
    on conflict (user_id, program_code) do update
    set participant_type = excluded.participant_type,
        work_type = excluded.work_type,
        updated_at = now();
  end loop;
end;
$$;


--
-- Name: admin_archive_user(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_archive_user(user_id_param uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  target_user public.users%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into target_user
  from public.users
  where id = user_id_param
  for update;
  if target_user.id is null then raise exception 'User not found'; end if;
  if target_user.role = 'ADMIN' then raise exception 'Admin accounts cannot be archived here'; end if;

  update public.users
  set is_active = false
  where id = user_id_param and is_active is distinct from false;

  return jsonb_build_object(
    'archived', true,
    'user_id', target_user.id,
    'history_preserved', true,
    'already_inactive', target_user.is_active = false
  );
end;
$$;


--
-- Name: admin_archive_vendor(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_archive_vendor(vendor_id_param uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  target_vendor public.vendors%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into target_vendor
  from public.vendors
  where id = vendor_id_param
  for update;
  if target_vendor.id is null then raise exception 'Vendor not found'; end if;

  update public.vendors
  set status = 'REJECTED'
  where id = vendor_id_param and status is distinct from 'REJECTED';

  return jsonb_build_object(
    'archived', true,
    'vendor_id', target_vendor.id,
    'links_preserved', true,
    'already_rejected', target_vendor.status = 'REJECTED'
  );
end;
$$;


--
-- Name: admin_delete_external_access_application(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_external_access_application(application_id_param uuid, delete_reason_param text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  application_row public.external_access_applications%rowtype;
  normalized_reason text := nullif(btrim(coalesce(delete_reason_param, '')), '');
  admin_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into application_row
  from public.external_access_applications a
  where a.id = application_id_param
  for update;
  if application_row.id is null then raise exception 'Application not found'; end if;
  if application_row.status = 'CANCELLED' then raise exception 'Application is already deleted'; end if;

  update public.external_access_applications
  set status = 'CANCELLED',
      admin_note = coalesce(normalized_reason, admin_note),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = application_row.id;

  insert into public.external_application_status_history(
    application_id, from_status, to_status, changed_by, note
  ) values (
    application_row.id, application_row.status, 'CANCELLED', auth.uid(),
    coalesce(normalized_reason, 'Application deleted by Admin')
  );

  admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email, 'EXTERNAL_REGISTRATION_APPLICATION_DELETED', application_row.request_no,
    jsonb_build_object('application_id', application_row.id, 'reason', normalized_reason)::text
  );

  return jsonb_build_object(
    'deleted', true,
    'application_id', application_row.id,
    'request_no', application_row.request_no,
    'status', 'CANCELLED'
  );
end;
$$;


--
-- Name: admin_delete_question(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_delete_question(question_id_param uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  delete from public.questions where id = question_id_param;
end;
$$;


--
-- Name: admin_get_dashboard_summary(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_dashboard_summary() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_get_directory_page(text, integer, integer, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_directory_page(p_section text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10, p_search text DEFAULT NULL::text, p_vendor_filter text DEFAULT NULL::text, p_cert_filter text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_get_exam_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_exam_history() RETURNS TABLE(id uuid, user_id uuid, exam_type text, score integer, total_questions integer, status text, created_at timestamp with time zone, users jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    h.id, h.user_id, h.exam_type, h.score, h.total_questions, h.status, h.created_at,
    case when u.id is null then null else jsonb_build_object(
      'name', u.name,
      'national_id', u.national_id,
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


--
-- Name: admin_get_exam_history_page(integer, integer, text, text, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_exam_history_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 10, p_search text DEFAULT NULL::text, p_exam_type text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_date date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_get_external_access_application(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_external_access_application(application_id_param uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  result_value jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select jsonb_build_object(
    'application', jsonb_build_object(
      'id', a.id,
      'request_no', a.request_no,
      'company_name_submitted', a.company_name_submitted,
      'vendor_id', a.vendor_id,
      'company_resolution', a.company_resolution,
      'first_name_th', a.first_name_th,
      'last_name_th', a.last_name_th,
      'first_name_en', a.first_name_en,
      'last_name_en', a.last_name_en,
      'job_title', a.job_title,
      'login_email', a.login_email,
      'phone', a.phone,
      'status', a.status,
      'pdpa_agreed', a.pdpa_agreed,
      'pdpa_agreed_at', a.pdpa_agreed_at,
      'admin_note', a.admin_note,
      'rejection_reason', a.rejection_reason,
      'reviewed_by', a.reviewed_by,
      'reviewed_at', a.reviewed_at,
      'submitted_at', a.submitted_at,
      'created_at', a.created_at,
      'updated_at', a.updated_at
    ),
    'vendor', case when v.id is null then null else jsonb_build_object(
      'id', v.id, 'name', v.name, 'status', v.status
    ) end,
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type_code', t.type_code,
        'target_system', t.target_system
      ) order by t.type_code)
      from public.external_application_types t
      where t.application_id = a.id
    ), '[]'::jsonb),
    'coordinators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.contact_name,
        'is_primary', c.is_primary,
        'display_order', c.display_order
      ) order by c.display_order)
      from public.external_application_contacts c
      where c.application_id = a.id
    ), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'from_status', h.from_status,
        'to_status', h.to_status,
        'note', h.note,
        'changed_by', h.changed_by,
        'created_at', h.created_at
      ) order by h.created_at desc)
      from public.external_application_status_history h
      where h.application_id = a.id
    ), '[]'::jsonb)
  ) into result_value
  from public.external_access_applications a
  left join public.vendors v on v.id = a.vendor_id
  where a.id = application_id_param;

  if result_value is null then raise exception 'Application not found'; end if;
  return result_value;
end;
$$;


--
-- Name: admin_get_external_access_applications(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_external_access_applications(status_param text DEFAULT NULL::text, search_param text DEFAULT NULL::text, limit_param integer DEFAULT 100, offset_param integer DEFAULT 0) RETURNS TABLE(id uuid, request_no text, company_name_submitted text, vendor_id uuid, vendor_name text, vendor_status text, company_resolution text, first_name_th text, last_name_th text, first_name_en text, last_name_en text, job_title text, login_email text, phone text, status text, admin_note text, rejection_reason text, submitted_at timestamp with time zone, reviewed_at timestamp with time zone, types jsonb, coordinators jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  safe_limit integer := greatest(1, least(coalesce(limit_param, 100), 200));
  safe_offset integer := greatest(0, coalesce(offset_param, 0));
  search_value text := nullif(btrim(coalesce(search_param, '')), '');
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  return query
  select
    a.id,
    a.request_no,
    a.company_name_submitted,
    a.vendor_id,
    v.name,
    v.status,
    a.company_resolution,
    a.first_name_th,
    a.last_name_th,
    a.first_name_en,
    a.last_name_en,
    a.job_title,
    a.login_email,
    a.phone,
    a.status,
    a.admin_note,
    a.rejection_reason,
    a.submitted_at,
    a.reviewed_at,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'type_code', t.type_code,
        'target_system', t.target_system
      ) order by t.type_code)
      from public.external_application_types t
      where t.application_id = a.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', c.contact_name,
        'is_primary', c.is_primary,
        'display_order', c.display_order
      ) order by c.display_order)
      from public.external_application_contacts c
      where c.application_id = a.id
    ), '[]'::jsonb)
  from public.external_access_applications a
  left join public.vendors v on v.id = a.vendor_id
  where (
    (nullif(btrim(coalesce(status_param, '')), '') is null and a.status <> 'CANCELLED')
    or (nullif(btrim(coalesce(status_param, '')), '') is not null and a.status = upper(btrim(status_param)))
  )
    and (search_value is null or concat_ws(' ',
      a.request_no, a.company_name_submitted, a.first_name_th, a.last_name_th,
      a.first_name_en, a.last_name_en, a.login_email
    ) ilike '%' || search_value || '%')
  order by
    case a.status
      when 'SUBMITTED' then 1
      when 'UNDER_REVIEW' then 2
      when 'NEED_MORE_INFO' then 3
      when 'APPROVED' then 4
      when 'REJECTED' then 5
      else 6
    end,
    a.created_at desc
  limit safe_limit offset safe_offset;
end;
$$;


--
-- Name: admin_get_external_registration_notification_recipients(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_external_registration_notification_recipients() RETURNS TABLE(id uuid, display_name text, email text, purpose text, is_active boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  return query
  select r.id, r.display_name, r.email, r.purpose, r.is_active,
    r.created_at, r.updated_at
  from public.external_registration_notification_recipients r
  where r.purpose = 'EXTERNAL_REGISTRATION_ADMIN'
  order by r.is_active desc, lower(r.email), r.created_at;
end;
$$;


--
-- Name: admin_get_external_registration_result_email_batch(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_external_registration_result_email_batch(application_id_param uuid) RETURNS TABLE(id uuid, template_key text, recipient_email text, recipient_name text, payload jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    o.id,
    o.template_key,
    o.recipient_email,
    o.recipient_name,
    o.payload || coalesce(
      jsonb_strip_nulls(jsonb_build_object(
        'trackingToken', (
          select received.payload ->> 'trackingToken'
          from public.external_registration_email_outbox received
          where received.application_id = o.application_id
            and received.template_key = 'external_registration_applicant_received'
          order by received.created_at, received.id
          limit 1
        )
      )),
      '{}'::jsonb
    )
  from public.external_registration_email_outbox o
  where o.application_id = application_id_param
    and o.template_key = 'external_registration_applicant_result'
    and o.status in ('PENDING', 'FAILED')
    and (o.next_attempt_at is null or o.next_attempt_at <= now())
  order by o.created_at, o.id;
end;
$$;


--
-- Name: admin_get_external_registration_vendors(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_external_registration_vendors() RETURNS TABLE(id uuid, name text, status text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select v.id, v.name, v.status
  from public.vendors v
  order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end,
    lower(v.name), v.created_at;
end;
$$;


--
-- Name: admin_get_question_revisions(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_question_revisions(question_id_param uuid) RETURNS TABLE(id uuid, question_id uuid, revision_no integer, change_type text, note text, changed_by uuid, changed_by_name text, changed_at timestamp with time zone, snapshot jsonb, is_current boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.questions q where q.id = question_id_param) then
    raise exception 'Question not found';
  end if;

  return query
  select
    qr.id,
    qr.question_id,
    qr.revision_no,
    qr.change_type,
    qr.note,
    qr.changed_by,
    coalesce(u.name, 'ระบบ') as changed_by_name,
    qr.changed_at,
    qr.snapshot,
    qr.revision_no = max(qr.revision_no) over (partition by qr.question_id) as is_current
  from public.question_revisions qr
  left join public.users u on u.id = qr.changed_by
  where qr.question_id = question_id_param
  order by qr.revision_no desc;
end;
$$;


--
-- Name: admin_get_supplier_outsource_launch_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_supplier_outsource_launch_status() RETURNS TABLE(enabled boolean, active_question_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    coalesce((select sc.value::boolean from public.system_config sc
      where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'), false),
    (select count(*) from public.questions q
      where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true);
end;
$$;


--
-- Name: admin_get_vendor_duplicate_groups(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_vendor_duplicate_groups() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_list_users(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_users() RETURNS TABLE(id uuid, national_id text, name text, vendor_id uuid, role text, induction_expiry timestamp with time zone, created_at timestamp with time zone, age integer, nationality text, pdpa_agreed boolean, is_active boolean, date_of_birth date, avatar_url text, last_login timestamp with time zone, vendors jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
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
    case when v.id is null then null else jsonb_build_object('name', v.name) end
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  order by u.created_at desc;
end;
$$;


--
-- Name: admin_record_external_registration_email_result(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_record_external_registration_email_result(outbox_id_param uuid, sent_param boolean, error_param text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.external_registration_email_outbox o
  set status = case when coalesce(sent_param, false) then 'SENT' else 'FAILED' end,
      attempts = o.attempts + 1,
      last_error = case when coalesce(sent_param, false) then null else left(error_param, 1000) end,
      next_attempt_at = case when coalesce(sent_param, false) then null else now() + interval '5 minutes' end,
      sent_at = case when coalesce(sent_param, false) then now() else o.sent_at end,
      updated_at = now()
  where o.id = outbox_id_param
    and o.template_key = 'external_registration_applicant_result';
  if not found then raise exception 'Email record not found'; end if;
end;
$$;


--
-- Name: admin_remove_external_registration_notification_recipient(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_remove_external_registration_notification_recipient(recipient_id_param uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  admin_email text;
  recipient_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  update public.external_registration_notification_recipients
  set is_active = false
  where id = recipient_id_param
    and purpose = 'EXTERNAL_REGISTRATION_ADMIN'
  returning email into recipient_email;

  if recipient_email is null then raise exception 'Email recipient not found'; end if;
  admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email, 'EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_DISABLED', recipient_id_param::text,
    jsonb_build_object('email', recipient_email)::text
  );
end;
$$;


--
-- Name: admin_reset_induction(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reset_induction(user_ids_param uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  affected_rows integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.users set induction_expiry = null where id = any(user_ids_param);
  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;


--
-- Name: admin_resolve_external_access_application(uuid, text, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_resolve_external_access_application(application_id_param uuid, action_param text, vendor_id_param uuid DEFAULT NULL::uuid, new_company_status_param text DEFAULT 'PENDING'::text, admin_note_param text DEFAULT NULL::text, rejection_reason_param text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  application_row public.external_access_applications%rowtype;
  selected_vendor public.vendors%rowtype;
  existing_vendor public.vendors%rowtype;
  final_vendor_id uuid;
  final_resolution text;
  next_status text := upper(btrim(coalesce(action_param, '')));
  company_status_value text := upper(btrim(coalesce(new_company_status_param, 'PENDING')));
  normalized_company text;
  normalized_note text := nullif(btrim(coalesce(admin_note_param, '')), '');
  normalized_rejection text := nullif(btrim(coalesce(rejection_reason_param, '')), '');
  applicant_name text;
  type_label text;
  coordinator_label text;
  vendor_name_value text;
  payload jsonb;
  admin_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if next_status not in ('APPROVED', 'REJECTED', 'NEED_MORE_INFO', 'UNDER_REVIEW') then
    raise exception 'Invalid application action';
  end if;
  if company_status_value not in ('PENDING', 'APPROVED') then
    raise exception 'Invalid company status';
  end if;
  if next_status = 'REJECTED' and normalized_rejection is null then
    raise exception 'Rejection reason is required';
  end if;
  if next_status = 'NEED_MORE_INFO' and normalized_note is null then
    raise exception 'Admin note is required';
  end if;

  select * into application_row
  from public.external_access_applications a
  where a.id = application_id_param
  for update;
  if application_row.id is null then raise exception 'Application not found'; end if;
  if application_row.status in ('APPROVED', 'REJECTED', 'CANCELLED') then
    raise exception 'Application is already finalized';
  end if;

  final_vendor_id := application_row.vendor_id;
  final_resolution := application_row.company_resolution;

  if next_status = 'APPROVED' then
    if vendor_id_param is not null then
      select * into selected_vendor
      from public.vendors v
      where v.id = vendor_id_param
      for update;
      if selected_vendor.id is null then raise exception 'Selected company not found'; end if;
      if selected_vendor.status = 'REJECTED' then raise exception 'Selected company is rejected'; end if;
      final_vendor_id := selected_vendor.id;
      final_resolution := case selected_vendor.status
        when 'APPROVED' then 'MATCHED_EXISTING'
        else 'LINKED_PENDING'
      end;
      vendor_name_value := selected_vendor.name;
    else
      normalized_company := public.normalize_vendor_name(application_row.company_name_submitted);
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_company, 0));
      select * into existing_vendor
      from public.vendors v
      where coalesce(v.normalized_name, public.normalize_vendor_name(v.name)) = normalized_company
      order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end,
        v.created_at, v.id
      limit 1
      for update;

      if existing_vendor.id is not null then
        if existing_vendor.status = 'REJECTED' then raise exception 'Company name is rejected'; end if;
        final_vendor_id := existing_vendor.id;
        final_resolution := case existing_vendor.status
          when 'APPROVED' then 'MATCHED_EXISTING'
          else 'LINKED_PENDING'
        end;
        vendor_name_value := existing_vendor.name;
      else
        insert into public.vendors(name, status)
        values (application_row.company_name_submitted, company_status_value)
        returning id, name into final_vendor_id, vendor_name_value;
        final_resolution := 'CREATED_NEW';
      end if;
    end if;
  elsif next_status = 'REJECTED' and final_vendor_id is null then
    final_resolution := 'REJECTED';
  end if;

  if next_status = 'APPROVED' and final_vendor_id is null then
    raise exception 'A company must be linked before approval';
  end if;

  update public.external_access_applications
  set status = next_status,
      vendor_id = final_vendor_id,
      company_resolution = coalesce(final_resolution, 'UNRESOLVED'),
      admin_note = normalized_note,
      rejection_reason = case when next_status = 'REJECTED' then normalized_rejection else null end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = application_row.id;

  insert into public.external_application_status_history(
    application_id, from_status, to_status, changed_by, note
  ) values (
    application_row.id, application_row.status, next_status, auth.uid(),
    coalesce(normalized_note, normalized_rejection)
  );

  if next_status in ('APPROVED', 'REJECTED') then
    applicant_name := application_row.first_name_th || ' ' || application_row.last_name_th;
    select array_to_string(array_agg(t.type_code order by t.type_code), ', ')
    into type_label
    from public.external_application_types t
    where t.application_id = application_row.id;
    select array_to_string(array_agg(c.contact_name order by c.display_order), ', ')
    into coordinator_label
    from public.external_application_contacts c
    where c.application_id = application_row.id;
    select coalesce(vendor_name_value, v.name, application_row.company_name_submitted)
    into vendor_name_value
    from public.external_access_applications a
    left join public.vendors v on v.id = coalesce(final_vendor_id, a.vendor_id)
    where a.id = application_row.id;

    payload := jsonb_build_object(
      'requestNo', application_row.request_no,
      'companyName', application_row.company_name_submitted,
      'applicantName', applicant_name,
      'applicantNameEnglish', application_row.first_name_en || ' ' || application_row.last_name_en,
      'jobTitle', application_row.job_title,
      'types', coalesce(type_label, ''),
      'email', application_row.login_email,
      'phone', application_row.phone,
      'coordinators', coalesce(coordinator_label, ''),
      'status', next_status,
      'note', coalesce(normalized_note, normalized_rejection, ''),
      'companyResolution', coalesce(final_resolution, 'UNRESOLVED'),
      'vendorName', coalesce(vendor_name_value, application_row.company_name_submitted)
    );

    insert into public.external_registration_email_outbox(
      application_id, template_key, recipient_email, recipient_name, payload
    ) values (
      application_row.id, 'external_registration_applicant_result',
      application_row.login_email, applicant_name, payload
    );
  end if;

  admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email,
    'EXTERNAL_REGISTRATION_APPLICATION_' || next_status,
    application_row.request_no,
    jsonb_build_object(
      'application_id', application_row.id,
      'vendor_id', final_vendor_id,
      'company_resolution', coalesce(final_resolution, 'UNRESOLVED'),
      'company_status', company_status_value,
      'note', normalized_note,
      'rejection_reason', normalized_rejection
    )::text
  );

  return jsonb_build_object(
    'saved', true,
    'application_id', application_row.id,
    'request_no', application_row.request_no,
    'status', next_status,
    'vendor_id', final_vendor_id,
    'company_resolution', coalesce(final_resolution, 'UNRESOLVED'),
    'vendor_name', vendor_name_value
  );
end;
$$;


--
-- Name: admin_restore_question_revision(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_restore_question_revision(question_id_param uuid, revision_id_param uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  revision_record public.question_revisions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  perform 1 from public.questions where id = question_id_param for update;
  if not found then raise exception 'Question not found'; end if;

  select * into revision_record
  from public.question_revisions
  where id = revision_id_param and question_id = question_id_param;
  if revision_record.id is null then raise exception 'Revision not found'; end if;

  update public.questions
  set
    type = revision_record.snapshot->>'type',
    pattern = revision_record.snapshot->>'pattern',
    content_th = revision_record.snapshot->>'content_th',
    content_en = revision_record.snapshot->>'content_en',
    choices_json = revision_record.snapshot->'choices_json',
    correct_choice_index = coalesce((revision_record.snapshot->>'correct_choice_index')::integer, 0),
    image_url = nullif(revision_record.snapshot->>'image_url', ''),
    is_active = coalesce((revision_record.snapshot->>'is_active')::boolean, false)
  where id = question_id_param;

  perform public.capture_question_revision(
    question_id_param,
    'RESTORE',
    format('Restored revision %s', revision_record.revision_no)
  );
  return question_id_param;
end;
$$;


--
-- Name: admin_save_external_registration_notification_recipient(uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_external_registration_notification_recipient(recipient_id_param uuid DEFAULT NULL::uuid, display_name_param text DEFAULT NULL::text, email_param text DEFAULT NULL::text, is_active_param boolean DEFAULT true) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  result_id uuid;
  normalized_email text := lower(btrim(coalesce(email_param, '')));
  normalized_name text := nullif(btrim(coalesce(display_name_param, '')), '');
  admin_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid email address';
  end if;
  if length(normalized_email) > 320 then raise exception 'Email address is too long'; end if;
  if normalized_name is not null and length(normalized_name) > 160 then
    raise exception 'Display name is too long';
  end if;

  if recipient_id_param is null then
    insert into public.external_registration_notification_recipients(
      display_name, email, purpose, is_active, created_by
    ) values (
      normalized_name, normalized_email, 'EXTERNAL_REGISTRATION_ADMIN',
      coalesce(is_active_param, true), auth.uid()
    ) returning id into result_id;
    admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
    insert into public.audit_logs(admin_email, action, target, details)
    values (
      admin_email, 'EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_ADDED', result_id::text,
      jsonb_build_object('email', normalized_email, 'is_active', coalesce(is_active_param, true))::text
    );
  else
    update public.external_registration_notification_recipients
    set display_name = normalized_name,
        email = normalized_email,
        is_active = coalesce(is_active_param, true)
    where id = recipient_id_param
      and purpose = 'EXTERNAL_REGISTRATION_ADMIN'
    returning id into result_id;

    if result_id is null then raise exception 'Email recipient not found'; end if;
    admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
    insert into public.audit_logs(admin_email, action, target, details)
    values (
      admin_email, 'EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_UPDATED', result_id::text,
      jsonb_build_object('email', normalized_email, 'is_active', coalesce(is_active_param, true))::text
    );
  end if;

  return result_id;
exception
  when unique_violation then
    raise exception 'Email recipient already exists';
end;
$_$;


--
-- Name: admin_save_question(uuid, text, text, text, text, jsonb, integer, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_question(question_id_param uuid, exam_type_param text, pattern_param text, content_th_param text, content_en_param text, choices_json_param jsonb, correct_choice_index_param integer, image_url_param text, is_active_param boolean DEFAULT true) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  result_id uuid;
  previous_active boolean;
  revision_action text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if pattern_param not in ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'MATCHING', 'SHORT_ANSWER') then raise exception 'Invalid question pattern'; end if;
  if nullif(trim(content_th_param), '') is null or nullif(trim(content_en_param), '') is null then raise exception 'Question text is required'; end if;

  if question_id_param is null then
    insert into public.questions(type, pattern, content_th, content_en, choices_json,
      correct_choice_index, image_url, is_active)
    values (exam_type_param, pattern_param, trim(content_th_param), trim(content_en_param),
      choices_json_param, correct_choice_index_param, image_url_param, coalesce(is_active_param, false))
    returning id into result_id;
    perform public.capture_question_revision(result_id, 'CREATE', 'Created question');
  else
    select coalesce(is_active, false) into previous_active
    from public.questions
    where id = question_id_param
    for update;
    if not found then raise exception 'Question not found'; end if;

    update public.questions set type = exam_type_param, pattern = pattern_param,
      content_th = trim(content_th_param), content_en = trim(content_en_param),
      choices_json = choices_json_param, correct_choice_index = correct_choice_index_param,
      image_url = image_url_param, is_active = coalesce(is_active_param, false)
    where id = question_id_param returning id into result_id;

    revision_action := case
      when previous_active = false and coalesce(is_active_param, false) = true then 'PUBLISH'
      when previous_active = true and coalesce(is_active_param, false) = false then 'UNPUBLISH'
      else 'SAVE'
    end;
    perform public.capture_question_revision(result_id, revision_action, null);
  end if;
  return result_id;
end;
$$;


--
-- Name: admin_save_vendor(uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_save_vendor(vendor_id_param uuid, name_param text, status_param text DEFAULT 'PENDING'::text, allow_similar_param boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: admin_set_external_registration_feature(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_external_registration_feature(enabled_param boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  admin_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  insert into public.system_config(key, value)
  values ('EXTERNAL_REGISTRATION_ENABLED', case when coalesce(enabled_param, false) then 'true' else 'false' end)
  on conflict (key) do update
    set value = excluded.value;

  admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email, 'EXTERNAL_REGISTRATION_FEATURE_TOGGLED', 'EXTERNAL_REGISTRATION_ENABLED',
    jsonb_build_object('enabled', coalesce(enabled_param, false))::text
  );
end;
$$;


--
-- Name: admin_set_supplier_outsource_access(uuid, boolean, text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_supplier_outsource_access(user_id_param uuid, enabled_param boolean, participant_type_param text DEFAULT NULL::text, work_type_param text DEFAULT NULL::text, access_start_date_param date DEFAULT NULL::date, access_end_date_param date DEFAULT NULL::date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  current_access public.user_training_access%rowtype;
  access_changed boolean := false;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if enabled_param then
    if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;

    select * into current_access
    from public.user_training_access
    where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE'
    for update;

    if found then
      access_changed := current_access.participant_type is distinct from participant_type_param
        or current_access.work_type is distinct from work_type_param
        or current_access.access_start_date is distinct from access_start_date_param
        or current_access.access_end_date is distinct from access_end_date_param;

      if access_changed then
        update public.supplier_outsource_passes
        set status = 'REVOKED'
        where user_id = user_id_param and status = 'ACTIVE';
      end if;

      update public.user_training_access
      set participant_type = participant_type_param,
          work_type = work_type_param,
          access_start_date = access_start_date_param,
          access_end_date = access_end_date_param,
          passed_at = case when access_changed then null else passed_at end,
          expires_at = case when access_changed then null else expires_at end,
          updated_at = now()
      where user_id = current_access.user_id
        and program_code = current_access.program_code;
    else
      insert into public.user_training_access(
        user_id, program_code, participant_type, work_type, access_start_date, access_end_date
      ) values (
        user_id_param, 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
        access_start_date_param, access_end_date_param
      );
    end if;
  else
    update public.supplier_outsource_passes set status = 'REVOKED'
    where user_id = user_id_param and status = 'ACTIVE';
    delete from public.user_training_access
    where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE';
  end if;
end;
$$;


--
-- Name: admin_set_supplier_outsource_access_bulk(uuid[], text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_supplier_outsource_access_bulk(user_ids_param uuid[], participant_type_param text, work_type_param text, access_start_date_param date DEFAULT NULL::date, access_end_date_param date DEFAULT NULL::date) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  user_id_value uuid;
  normalized_start date := coalesce(access_start_date_param, current_date);
  normalized_end date;
  saved_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if coalesce(cardinality(user_ids_param), 0) = 0 or cardinality(user_ids_param) > 5000 then
    raise exception 'Select between 1 and 5000 users';
  end if;
  if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
  if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;

  normalized_end := coalesce(access_end_date_param, (normalized_start + interval '1 year')::date);
  if normalized_end < normalized_start then raise exception 'Invalid access dates'; end if;

  for user_id_value in select distinct value from unnest(user_ids_param) value loop
    if not exists (
      select 1 from public.users u
      where u.id = user_id_value and coalesce(u.is_active, false) and u.role <> 'ADMIN'
    ) then raise exception 'Selected user is unavailable'; end if;

    perform public.admin_set_supplier_outsource_access(
      user_id_value, true, participant_type_param, work_type_param,
      normalized_start, normalized_end
    );
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;


--
-- Name: admin_set_supplier_outsource_feature(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_supplier_outsource_feature(enabled_param boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if enabled_param and (
    select count(*) from public.questions q
    where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true
  ) < 20 then raise exception 'At least 20 active Supplier and Outsource questions are required'; end if;
  insert into public.system_config(key, value)
  values ('SUPPLIER_OUTSOURCE_ENABLED', enabled_param::text)
  on conflict (key) do update set value = excluded.value;
end;
$$;


--
-- Name: admin_set_training_access(uuid, text, boolean, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_training_access(user_id_param uuid, program_code_param text, enabled_param boolean, participant_type_param text DEFAULT NULL::text, work_type_param text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if program_code_param not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid program code'; end if;
  if participant_type_param is not null and participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
  if work_type_param is not null and work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;

  if enabled_param then
    insert into public.user_training_access(user_id, program_code, participant_type, work_type)
    values (
      user_id_param,
      program_code_param,
      case when program_code_param = 'SUPPLIER_OUTSOURCE' then participant_type_param else null end,
      case when program_code_param = 'SUPPLIER_OUTSOURCE' then work_type_param else null end
    )
    on conflict (user_id, program_code) do update
    set participant_type = excluded.participant_type,
        work_type = excluded.work_type,
        updated_at = now();
  else
    delete from public.user_training_access
    where user_id = user_id_param and program_code = program_code_param;
  end if;
end;
$$;


--
-- Name: admin_set_user_active(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_user_active(user_id_param uuid, is_active_param boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.users set is_active = is_active_param where id = user_id_param;
  if not found then raise exception 'User not found'; end if;
end;
$$;


--
-- Name: admin_supplier_outsource_report(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_supplier_outsource_report() RETURNS TABLE(user_id uuid, company text, name text, participant_type text, work_type text, national_id text, test_date timestamp with time zone, expiration_date timestamp with time zone, score integer, total_questions integer, result_status text, access_start_date date, access_end_date date, verification_token uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select u.id, coalesce(v.name, '-'), u.name, a.participant_type, a.work_type,
    case
      when u.national_id ~ '^[0-9]{13}$' then u.national_id
      when au.email ~ '^[0-9]{13}@safetypass[.]com$' then split_part(au.email, '@', 1)
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
$_$;


--
-- Name: admin_update_system_setting(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_system_setting(key_param text, value_param text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if key_param not in (
    'PASSING_SCORE_INDUCTION',
    'PASSING_SCORE_WORK_PERMIT',
    'PASSING_SCORE_SUPPLIER_OUTSOURCE',
    'SUPPLIER_OUTSOURCE_VALIDITY_DAYS',
    'manual_url',
    'support_url'
  ) then
    raise exception 'Unsupported system setting';
  end if;

  if key_param like 'PASSING_SCORE_%'
     and (value_param !~ '^\d{1,3}$' or value_param::integer < 0 or value_param::integer > 100) then
    raise exception 'Passing score must be between 0 and 100';
  end if;

  if key_param = 'SUPPLIER_OUTSOURCE_VALIDITY_DAYS'
     and (value_param !~ '^\d{1,4}$' or value_param::integer < 1 or value_param::integer > 3650) then
    raise exception 'Validity days must be between 1 and 3650';
  end if;

  if key_param in ('manual_url', 'support_url')
     and value_param <> ''
     and value_param !~* '^https://[^[:space:]]+$' then
    raise exception 'Support links must use HTTPS';
  end if;

  insert into public.system_config(key, value)
  values (key_param, value_param)
  on conflict (key) do update set value = excluded.value;
end;
$_$;


--
-- Name: admin_update_user_profile(uuid, text, integer, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_user_profile(user_id_param uuid, name_param text, age_param integer, nationality_param text, vendor_id_param uuid, induction_expiry_param timestamp with time zone) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.users
  set name = trim(name_param), age = age_param, nationality = nationality_param,
      vendor_id = vendor_id_param, induction_expiry = induction_expiry_param
  where id = user_id_param;
  if not found then raise exception 'User not found'; end if;
end;
$$;


--
-- Name: admin_upsert_staged_user(text, text, uuid, text, integer, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_staged_user(national_id_param text, name_param text, vendor_id_param uuid DEFAULT NULL::uuid, role_param text DEFAULT 'USER'::text, age_param integer DEFAULT NULL::integer, nationality_param text DEFAULT 'ไทย (Thai)'::text, induction_expiry_param timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  target_id uuid;
  national_hash text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if role_param not in ('ADMIN', 'USER') then raise exception 'Invalid role'; end if;
  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');

  select id into target_id
  from public.users
  where national_id_fingerprint = national_hash
  order by coalesce(pdpa_agreed, false) desc, created_at desc
  limit 1 for update;
  if target_id is null then
    target_id := gen_random_uuid();
    insert into public.users(
      id, national_id, name, vendor_id, role, age, nationality,
      induction_expiry, pdpa_agreed, is_active, national_id_hash, national_id_fingerprint
    ) values (
      target_id, national_id_param, trim(name_param), vendor_id_param, role_param,
      age_param, nationality_param, induction_expiry_param, false, true, national_hash, national_hash
    );
  else
    update public.users
    set name = trim(name_param), vendor_id = vendor_id_param, role = role_param,
        age = age_param, nationality = nationality_param,
        induction_expiry = induction_expiry_param
    where id = target_id;
  end if;

  insert into public.user_training_access(user_id, program_code)
  values (target_id, 'CONTRACTOR')
  on conflict (user_id, program_code) do nothing;
  return target_id;
end;
$_$;


--
-- Name: audit_admin_directory_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_admin_directory_mutation() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  admin_email_value text;
  target_id uuid;
  changed_fields text[] := array[]::text[];
  action_value text;
begin
  if auth.uid() is null or not public.is_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select coalesce(au.email, 'unknown') into admin_email_value
  from auth.users au
  where au.id = auth.uid();
  admin_email_value := coalesce(admin_email_value, 'unknown');

  if tg_op = 'INSERT' then
    target_id := new.id;
    changed_fields := array['record_created'];
  elsif tg_op = 'DELETE' then
    target_id := old.id;
    changed_fields := array['record_deleted'];
  else
    target_id := new.id;
    if tg_table_name = 'users' then
      changed_fields := array_remove(array[
        case when new.name is distinct from old.name then 'name' end,
        case when new.age is distinct from old.age then 'age' end,
        case when new.nationality is distinct from old.nationality then 'nationality' end,
        case when new.vendor_id is distinct from old.vendor_id then 'vendor_id' end,
        case when new.role is distinct from old.role then 'role' end,
        case when new.is_active is distinct from old.is_active then 'is_active' end,
        case when new.induction_expiry is distinct from old.induction_expiry then 'induction_expiry' end,
        case when new.pdpa_agreed is distinct from old.pdpa_agreed then 'pdpa_agreed' end
      ], null);
    elsif tg_table_name = 'vendors' then
      changed_fields := array_remove(array[
        case when new.name is distinct from old.name then 'name' end,
        case when new.status is distinct from old.status then 'status' end
      ], null);
    end if;
  end if;

  if coalesce(cardinality(changed_fields), 0) = 0 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  action_value := case
    when tg_table_name = 'users' and tg_op = 'INSERT' then 'ADMIN_USER_CREATED'
    when tg_table_name = 'users' and tg_op = 'DELETE' then 'ADMIN_USER_DELETED'
    when tg_table_name = 'users' and tg_op = 'UPDATE'
      and changed_fields = array['is_active']::text[]
      and (to_jsonb(old) ->> 'is_active')::boolean is distinct from false
      and (to_jsonb(new) ->> 'is_active')::boolean = false
      then 'ADMIN_USER_ARCHIVED'
    when tg_table_name = 'users' and tg_op = 'UPDATE'
      and changed_fields = array['is_active']::text[]
      and (to_jsonb(old) ->> 'is_active')::boolean = false
      and (to_jsonb(new) ->> 'is_active')::boolean = true
      then 'ADMIN_USER_REACTIVATED'
    when tg_table_name = 'users' and tg_op = 'UPDATE'
      and changed_fields = array['induction_expiry']::text[]
      and to_jsonb(new) ->> 'induction_expiry' is null
      then 'ADMIN_INDUCTION_RESET'
    when tg_table_name = 'users' then 'ADMIN_USER_UPDATED'
    when tg_table_name = 'vendors' and tg_op = 'INSERT' then 'ADMIN_VENDOR_CREATED'
    when tg_table_name = 'vendors' and tg_op = 'DELETE' then 'ADMIN_VENDOR_DELETED'
    when tg_table_name = 'vendors' and tg_op = 'UPDATE'
      and changed_fields = array['status']::text[]
      and to_jsonb(new) ->> 'status' = 'REJECTED'
      then 'ADMIN_VENDOR_ARCHIVED'
    else 'ADMIN_VENDOR_UPDATED'
  end;

  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email_value,
    action_value,
    tg_table_name || ':' || target_id::text,
    jsonb_build_object(
      'operation', tg_op,
      'changed_fields', to_jsonb(changed_fields),
      'values_recorded', false
    )::text
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


--
-- Name: capture_question_revision(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.capture_question_revision(question_id_param uuid, change_type_param text, note_param text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  question_record public.questions%rowtype;
  next_revision integer;
  revision_id uuid;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if change_type_param not in ('BASELINE', 'CREATE', 'SAVE', 'PUBLISH', 'UNPUBLISH', 'RESTORE') then
    raise exception 'Invalid revision change type';
  end if;

  select * into question_record
  from public.questions
  where id = question_id_param;
  if question_record.id is null then raise exception 'Question not found'; end if;

  select coalesce(max(revision_no), 0) + 1 into next_revision
  from public.question_revisions
  where question_id = question_id_param;

  insert into public.question_revisions (
    question_id, revision_no, snapshot, change_type, note, changed_by
  ) values (
    question_record.id,
    next_revision,
    jsonb_build_object(
      'id', question_record.id,
      'type', question_record.type,
      'pattern', question_record.pattern,
      'content_th', question_record.content_th,
      'content_en', question_record.content_en,
      'choices_json', question_record.choices_json,
      'correct_choice_index', question_record.correct_choice_index,
      'image_url', question_record.image_url,
      'is_active', coalesce(question_record.is_active, false)
    ),
    change_type_param,
    nullif(trim(note_param), ''),
    auth.uid()
  ) returning id into revision_id;

  return revision_id;
end;
$$;


--
-- Name: check_user_exists(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_user_exists(search_id text) RETURNS TABLE(user_exists boolean, requires_registration boolean, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select
    true,
    not coalesce(u.pdpa_agreed, false),
    coalesce(u.is_active, false)
  from public.users u
  where search_id ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(search_id, 'sha256'), 'hex')
  order by coalesce(u.pdpa_agreed, false) desc, coalesce(u.is_active, false) desc, u.created_at desc
  limit 1
$_$;


--
-- Name: complete_registration(text, text, uuid, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_registration(national_id_param text, name_param text, vendor_id_param uuid DEFAULT NULL::uuid, age_param integer DEFAULT NULL::integer, nationality_param text DEFAULT 'ไทย (Thai)'::text, other_vendor_name_param text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  auth_user_id uuid := auth.uid();
  auth_email text;
  national_hash text;
  linked_user public.users%rowtype;
  staged_user public.users%rowtype;
  final_vendor_id uuid := vendor_id_param;
  result_value jsonb;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if nullif(trim(name_param), '') is null then raise exception 'Name is required'; end if;
  if age_param is not null and (age_param < 0 or age_param > 120) then raise exception 'Invalid age'; end if;

  select lower(email) into auth_email from auth.users where id = auth_user_id;
  if auth_email is distinct from lower(national_id_param || '@safetypass.com') then
    raise exception 'Authenticated identity does not match registration';
  end if;

  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  select * into linked_user from public.users where id = auth_user_id for update;
  select * into staged_user
  from public.users
  where id <> auth_user_id
    and national_id_fingerprint = national_hash
    and not coalesce(pdpa_agreed, false)
  order by created_at desc
  limit 1 for update;

  if linked_user.id is not null and coalesce(linked_user.pdpa_agreed, false) then
    raise exception 'Account is already registered';
  end if;
  if linked_user.id is not null and linked_user.national_id_fingerprint is distinct from national_hash then
    raise exception 'Authenticated profile does not match registration';
  end if;
  if linked_user.id is not null and not coalesce(linked_user.is_active, false) then
    raise exception 'Account is suspended';
  end if;
  if staged_user.id is not null and not coalesce(staged_user.is_active, false) then
    raise exception 'Account is suspended';
  end if;

  if nullif(trim(other_vendor_name_param), '') is not null then
    insert into public.vendors(name, status)
    values (trim(other_vendor_name_param), 'PENDING')
    returning id into final_vendor_id;
  elsif final_vendor_id is not null and not exists (
    select 1 from public.vendors where id = final_vendor_id and status = 'APPROVED'
  ) then
    raise exception 'Selected vendor is unavailable';
  end if;

  if linked_user.id is null then
    if staged_user.id is not null then
      update public.users
      set national_id_hash = null, national_id_fingerprint = null, national_id_cipher = null
      where id = staged_user.id;
    end if;

    insert into public.users(
      id, national_id, name, vendor_id, role, induction_expiry, age, nationality,
      pdpa_agreed, pdpa_agreed_at, is_active, date_of_birth, avatar_url,
      national_id_hash, national_id_fingerprint
    ) values (
      auth_user_id,
      national_id_param,
      trim(name_param),
      final_vendor_id,
      coalesce(staged_user.role, 'USER'),
      staged_user.induction_expiry,
      age_param,
      coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'),
      true,
      now(),
      true,
      staged_user.date_of_birth,
      staged_user.avatar_url,
      national_hash,
      national_hash
    );
  else
    update public.users
    set name = trim(name_param),
        vendor_id = final_vendor_id,
        age = age_param,
        nationality = coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'),
        pdpa_agreed = true,
        pdpa_agreed_at = now()
    where id = auth_user_id;
  end if;

  if staged_user.id is not null then
    update public.exam_history set user_id = auth_user_id where user_id = staged_user.id;
    update public.exam_logs set user_id = auth_user_id where user_id = staged_user.id;
    update public.work_permits set user_id = auth_user_id where user_id = staged_user.id;
    delete from public.users where id = staged_user.id;
  end if;

  insert into public.user_training_access(user_id, program_code)
  values (auth_user_id, 'CONTRACTOR')
  on conflict (user_id, program_code) do nothing;

  select jsonb_build_object(
    'id', u.id,
    'national_id', national_id_param,
    'name', u.name,
    'vendor_id', u.vendor_id,
    'role', u.role,
    'induction_expiry', u.induction_expiry,
    'created_at', u.created_at,
    'age', u.age,
    'nationality', u.nationality,
    'pdpa_agreed', u.pdpa_agreed,
    'is_active', u.is_active,
    'date_of_birth', u.date_of_birth,
    'avatar_url', u.avatar_url,
    'last_login', u.last_login,
    'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
  ) into result_value
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where u.id = auth_user_id;

  return result_value;
end;
$_$;


--
-- Name: complete_registration_v2(text, text, uuid, integer, text, text, text[], text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_registration_v2(national_id_param text, name_param text, vendor_id_param uuid DEFAULT NULL::uuid, age_param integer DEFAULT NULL::integer, nationality_param text DEFAULT 'ไทย (Thai)'::text, other_vendor_name_param text DEFAULT NULL::text, program_codes_param text[] DEFAULT ARRAY['CONTRACTOR'::text], participant_type_param text DEFAULT NULL::text, work_type_param text DEFAULT NULL::text, access_start_date_param date DEFAULT NULL::date, access_end_date_param date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  auth_user_id uuid := auth.uid();
  auth_email text;
  national_hash text;
  linked_user public.users%rowtype;
  staged_user public.users%rowtype;
  final_vendor_id uuid := vendor_id_param;
  result_value jsonb;
  enabled_value boolean;
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

  if linked_user.id is not null and coalesce(linked_user.pdpa_agreed, false) then
    raise exception 'Account is already registered';
  end if;
  if linked_user.id is not null and linked_user.national_id_fingerprint is distinct from national_hash then
    raise exception 'Authenticated profile does not match registration';
  end if;
  if linked_user.id is not null and not coalesce(linked_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if staged_user.id is not null and not coalesce(staged_user.is_active, false) then raise exception 'Account is suspended'; end if;

  if nullif(trim(other_vendor_name_param), '') is not null then
    insert into public.vendors(name, status) values (trim(other_vendor_name_param), 'PENDING')
    returning id into final_vendor_id;
  elsif final_vendor_id is not null and not exists (
    select 1 from public.vendors where id = final_vendor_id and status = 'APPROVED'
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
    'last_login', u.last_login,
    'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
  ) into result_value
  from public.users u left join public.vendors v on v.id = u.vendor_id where u.id = auth_user_id;
  return result_value;
end;
$_$;


--
-- Name: complete_registration_v3(text, text, uuid, integer, text, text, text[], text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_registration_v3(national_id_param text, name_param text, vendor_id_param uuid DEFAULT NULL::uuid, age_param integer DEFAULT NULL::integer, nationality_param text DEFAULT 'ไทย (Thai)'::text, other_vendor_name_param text DEFAULT NULL::text, program_codes_param text[] DEFAULT ARRAY['CONTRACTOR'::text], participant_type_param text DEFAULT NULL::text, work_type_param text DEFAULT NULL::text, access_start_date_param date DEFAULT NULL::date, access_end_date_param date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: complete_registration_v4(text, text, uuid, integer, text, text, text[], text, text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_registration_v4(national_id_param text, name_param text, vendor_id_param uuid DEFAULT NULL::uuid, age_param integer DEFAULT NULL::integer, nationality_param text DEFAULT 'ไทย (Thai)'::text, other_vendor_name_param text DEFAULT NULL::text, program_codes_param text[] DEFAULT ARRAY['CONTRACTOR'::text], participant_type_param text DEFAULT NULL::text, work_type_param text DEFAULT NULL::text, access_start_date_param date DEFAULT NULL::date, access_end_date_param date DEFAULT NULL::date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: create_external_access_application(text, text[], text, text, text, text, text, text, text, text[], boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_external_access_application(company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[], pdpa_agreed_param boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  application_id_value uuid;
  request_no_value text;
  tracking_token_value text := gen_random_uuid()::text;
  normalized_company text := btrim(coalesce(company_name_param, ''));
  normalized_first_name_th text := btrim(coalesce(first_name_th_param, ''));
  normalized_last_name_th text := btrim(coalesce(last_name_th_param, ''));
  normalized_first_name_en text := btrim(coalesce(first_name_en_param, ''));
  normalized_last_name_en text := btrim(coalesce(last_name_en_param, ''));
  normalized_job_title text := btrim(coalesce(job_title_param, ''));
  normalized_email text := lower(btrim(coalesce(login_email_param, '')));
  normalized_phone text := btrim(coalesce(phone_param, ''));
  normalized_types text[];
  normalized_contacts text[];
  type_label text;
  coordinator_label text;
  applicant_name text;
  payload jsonb;
  applicant_payload jsonb;
begin
  if not public.get_external_registration_feature_flag() then
    raise exception 'External registration is not enabled';
  end if;
  if pdpa_agreed_param is not true then raise exception 'PDPA consent is required'; end if;
  if length(normalized_company) not between 2 and 200 then raise exception 'Invalid company name'; end if;
  if length(normalized_first_name_th) not between 1 and 120 then raise exception 'Invalid Thai first name'; end if;
  if length(normalized_last_name_th) not between 1 and 120 then raise exception 'Invalid Thai last name'; end if;
  if length(normalized_first_name_en) not between 1 and 120 then raise exception 'Invalid English first name'; end if;
  if length(normalized_last_name_en) not between 1 and 120 then raise exception 'Invalid English last name'; end if;
  if length(normalized_job_title) not between 1 and 160 then raise exception 'Invalid job title'; end if;
  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid email address'; end if;
  if length(normalized_email) > 320 then raise exception 'Email address is too long'; end if;
  if length(normalized_phone) not between 3 and 40 then raise exception 'Invalid phone number'; end if;

  select coalesce(array_agg(distinct upper(btrim(item.value))), '{}'::text[])
  into normalized_types
  from unnest(coalesce(requested_types_param, '{}'::text[])) as item(value)
  where btrim(item.value) <> '';
  if cardinality(normalized_types) = 0 then raise exception 'At least one user type is required'; end if;
  if exists (
    select 1 from unnest(normalized_types) as item(value)
    where item.value not in ('CONTRACTOR', 'SUPPLIER', 'OUTSOURCE')
  ) then raise exception 'Invalid user type'; end if;

  select coalesce(array_agg(btrim(item.value) order by item.ordinality) filter (where btrim(item.value) <> ''), '{}'::text[])
  into normalized_contacts
  from unnest(coalesce(coordinator_names_param, '{}'::text[])) with ordinality as item(value, ordinality);
  if cardinality(normalized_contacts) = 0 then raise exception 'At least one TSH coordinator is required'; end if;
  if exists (select 1 from unnest(normalized_contacts) as item(value) where length(item.value) > 160) then
    raise exception 'TSH coordinator name is too long';
  end if;

  applicant_name := normalized_first_name_th || ' ' || normalized_last_name_th;
  type_label := array_to_string(normalized_types, ', ');
  coordinator_label := array_to_string(normalized_contacts, ', ');

  insert into public.external_access_applications(
    company_name_submitted, first_name_th, last_name_th,
    first_name_en, last_name_en, job_title, login_email, phone,
    pdpa_agreed, pdpa_agreed_at, tracking_token_hash
  ) values (
    normalized_company, normalized_first_name_th, normalized_last_name_th,
    normalized_first_name_en, normalized_last_name_en, normalized_job_title,
    normalized_email, normalized_phone, true, now(),
    encode(extensions.digest(tracking_token_value, 'sha256'), 'hex')
  ) returning id, request_no into application_id_value, request_no_value;

  insert into public.external_application_types(application_id, type_code, target_system)
  select application_id_value, item.value,
    case when item.value = 'CONTRACTOR' then 'CONTRACTOR_ONLINE' else 'SUPPLIER_EPASS' end
  from unnest(normalized_types) as item(value);

  insert into public.external_application_contacts(application_id, contact_name, is_primary, display_order)
  select application_id_value, item.value, item.ordinality = 1, item.ordinality
  from unnest(normalized_contacts) with ordinality as item(value, ordinality);

  insert into public.external_application_status_history(application_id, from_status, to_status, note)
  values (application_id_value, null, 'SUBMITTED', 'Application submitted by applicant');

  payload := jsonb_build_object(
    'requestNo', request_no_value,
    'companyName', normalized_company,
    'applicantName', applicant_name,
    'applicantNameEnglish', normalized_first_name_en || ' ' || normalized_last_name_en,
    'jobTitle', normalized_job_title,
    'types', type_label,
    'email', normalized_email,
    'phone', normalized_phone,
    'coordinators', coordinator_label
  );
  applicant_payload := payload || jsonb_build_object('trackingToken', tracking_token_value);

  insert into public.external_registration_email_outbox(
    application_id, template_key, recipient_email, recipient_name, payload
  )
  select application_id_value, 'external_registration_admin_notice', r.email, r.display_name, payload
  from public.external_registration_notification_recipients r
  where r.purpose = 'EXTERNAL_REGISTRATION_ADMIN' and r.is_active;

  insert into public.external_registration_email_outbox(
    application_id, template_key, recipient_email, recipient_name, payload
  ) values (
    application_id_value, 'external_registration_applicant_received', normalized_email,
    applicant_name, applicant_payload
  );

  return jsonb_build_object(
    'request_no', request_no_value,
    'tracking_token', tracking_token_value,
    'status', 'SUBMITTED'
  );
end;
$_$;


--
-- Name: encrypt_user_data(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.encrypt_user_data() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  return new;
end;
$$;


--
-- Name: external_registration_queue_followup_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.external_registration_queue_followup_email() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  applicant_name text;
  type_label text;
  coordinator_label text;
  vendor_name_value text;
begin
  if old.status is not distinct from new.status
     or new.status not in ('UNDER_REVIEW', 'NEED_MORE_INFO') then
    return new;
  end if;

  applicant_name := new.first_name_th || ' ' || new.last_name_th;
  select array_to_string(array_agg(t.type_code order by t.type_code), ', ')
  into type_label
  from public.external_application_types t
  where t.application_id = new.id;
  select array_to_string(array_agg(c.contact_name order by c.display_order), ', ')
  into coordinator_label
  from public.external_application_contacts c
  where c.application_id = new.id;
  select coalesce(v.name, new.company_name_submitted)
  into vendor_name_value
  from public.external_access_applications a
  left join public.vendors v on v.id = new.vendor_id
  where a.id = new.id;

  insert into public.external_registration_email_outbox(
    application_id, template_key, recipient_email, recipient_name, payload
  ) values (
    new.id,
    'external_registration_applicant_result',
    new.login_email,
    applicant_name,
    jsonb_build_object(
      'requestNo', new.request_no,
      'companyName', new.company_name_submitted,
      'applicantName', applicant_name,
      'applicantNameEnglish', new.first_name_en || ' ' || new.last_name_en,
      'jobTitle', new.job_title,
      'types', coalesce(type_label, ''),
      'email', new.login_email,
      'phone', new.phone,
      'coordinators', coalesce(coordinator_label, ''),
      'status', new.status,
      'note', coalesce(new.admin_note, ''),
      'companyResolution', new.company_resolution,
      'vendorName', coalesce(vendor_name_value, new.company_name_submitted)
    )
  );

  return new;
end;
$$;


--
-- Name: external_registration_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.external_registration_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: find_vendor_name_matches(text, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_vendor_name_matches(search_name_param text, exclude_vendor_id_param uuid DEFAULT NULL::uuid, limit_param integer DEFAULT 5) RETURNS TABLE(id uuid, name text, status text, match_type text, match_score numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: get_auth_login_context(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_auth_login_context(national_id_param text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select jsonb_build_object(
    'user_exists', true,
    'user_id', u.id,
    'is_active', coalesce(u.is_active, false),
    'pin_version', coalesce(s.pin_version, 1),
    'locked_until', s.locked_until
  )
  from public.users u
  left join public.user_auth_security s on s.user_id = u.id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by exists (select 1 from auth.users au where au.id = u.id) desc,
           coalesce(u.pdpa_agreed, false) desc,
           u.created_at desc
  limit 1
$_$;


--
-- Name: get_exam_questions(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_exam_questions(exam_type_param text) RETURNS TABLE(id uuid, type text, pattern text, content_th text, content_en text, choices_json jsonb, image_url text, is_active boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if exam_type_param = 'SUPPLIER_OUTSOURCE' then
    if not coalesce((select sc.value::boolean from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'), false) then
      raise exception 'Program is not enabled';
    end if;
    if not exists (
      select 1 from public.user_training_access a
      where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
        and (a.access_start_date is null or a.access_start_date <= current_date)
        and (a.access_end_date is null or a.access_end_date >= current_date)
    ) then raise exception 'Supplier and Outsource access is required'; end if;
    if (select count(*) from public.questions q where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active) < 20 then
      raise exception 'At least 20 active Supplier and Outsource questions are required';
    end if;

    return query
    select q.id, q.type, q.pattern, q.content_th, q.content_en,
      case when jsonb_typeof(q.choices_json) = 'array' then
        coalesce((select jsonb_agg(choice - 'is_correct' - 'correct_answer')
          from jsonb_array_elements(q.choices_json) choice), '[]'::jsonb)
        else '[]'::jsonb end,
      q.image_url, q.is_active
    from public.questions q
    where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true
    order by q.created_at, q.id
    limit 20;
    return;
  end if;

  return query
  select q.id, q.type, q.pattern, q.content_th, q.content_en,
    case when jsonb_typeof(q.choices_json) = 'array' then
      coalesce((select jsonb_agg(choice - 'is_correct' - 'correct_answer')
        from jsonb_array_elements(q.choices_json) choice), '[]'::jsonb)
      else '[]'::jsonb end,
    q.image_url, q.is_active
  from public.questions q
  where q.type = exam_type_param and q.is_active = true
  order by q.created_at, q.id;
end;
$$;


--
-- Name: get_external_access_application_edit_form(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_external_access_application_edit_form(request_no_param text, tracking_token_param text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
declare
  application_row public.external_access_applications%rowtype;
  result_value jsonb;
begin
  select * into application_row
  from public.external_access_applications a
  where a.request_no = btrim(request_no_param)
    and a.tracking_token_hash = encode(extensions.digest(btrim(tracking_token_param), 'sha256'), 'hex')
  limit 1;

  if application_row.id is null then raise exception 'Application not found'; end if;
  if application_row.status not in ('NEED_MORE_INFO', 'REJECTED') then
    raise exception 'Application is not open for applicant updates';
  end if;

  select jsonb_build_object(
    'request_no', application_row.request_no,
    'status', application_row.status,
    'company_name', application_row.company_name_submitted,
    'first_name_th', application_row.first_name_th,
    'last_name_th', application_row.last_name_th,
    'first_name_en', application_row.first_name_en,
    'last_name_en', application_row.last_name_en,
    'job_title', application_row.job_title,
    'email', application_row.login_email,
    'phone', application_row.phone,
    'admin_note', application_row.admin_note,
    'rejection_reason', application_row.rejection_reason,
    'types', coalesce((
      select jsonb_agg(t.type_code order by t.type_code)
      from public.external_application_types t
      where t.application_id = application_row.id
    ), '[]'::jsonb),
    'coordinators', coalesce((
      select jsonb_agg(c.contact_name order by c.display_order)
      from public.external_application_contacts c
      where c.application_id = application_row.id
    ), '[]'::jsonb)
  ) into result_value;

  return result_value;
end;
$$;


--
-- Name: get_external_access_application_status(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_external_access_application_status(request_no_param text, tracking_token_param text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select jsonb_build_object(
    'request_no', a.request_no,
    'company_name', a.company_name_submitted,
    'company_resolution', a.company_resolution,
    'status', a.status,
    'submitted_at', a.submitted_at,
    'admin_note', a.admin_note,
    'rejection_reason', a.rejection_reason,
    'types', coalesce((
      select jsonb_agg(jsonb_build_object('type_code', t.type_code, 'target_system', t.target_system) order by t.type_code)
      from public.external_application_types t where t.application_id = a.id
    ), '[]'::jsonb),
    'coordinators', coalesce((
      select jsonb_agg(jsonb_build_object('name', c.contact_name, 'is_primary', c.is_primary) order by c.display_order)
      from public.external_application_contacts c where c.application_id = a.id
    ), '[]'::jsonb)
  )
  from public.external_access_applications a
  where a.request_no = btrim(request_no_param)
    and a.tracking_token_hash = encode(extensions.digest(btrim(tracking_token_param), 'sha256'), 'hex')
  limit 1
$$;


--
-- Name: get_external_registration_email_batch(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_external_registration_email_batch(request_no_param text, tracking_token_param text) RETURNS TABLE(id uuid, template_key text, recipient_email text, recipient_name text, payload jsonb)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select o.id, o.template_key, o.recipient_email, o.recipient_name, o.payload
  from public.external_registration_email_outbox o
  join public.external_access_applications a on a.id = o.application_id
  where a.request_no = btrim(request_no_param)
    and a.tracking_token_hash = encode(extensions.digest(btrim(tracking_token_param), 'sha256'), 'hex')
    and o.status = 'PENDING'
  order by o.created_at, o.id
$$;


--
-- Name: get_external_registration_feature_flag(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_external_registration_feature_flag() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((
    select sc.value::boolean
    from public.system_config sc
    where sc.key = 'EXTERNAL_REGISTRATION_ENABLED'
  ), false)
$$;


--
-- Name: get_my_admin_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_admin_status() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select public.is_admin()
$$;


--
-- Name: get_my_decrypted_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_decrypted_id() RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$ select null::text $$;


--
-- Name: get_my_staged_registration_profile(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_staged_registration_profile() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
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
$_$;


--
-- Name: get_my_supplier_outsource_access_notification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_supplier_outsource_access_notification() RETURNS TABLE(name text, vendor_name text, participant_type text, work_type text, access_start_date date, access_end_date date)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.name, coalesce(v.name, 'ไม่มีสังกัด'), a.participant_type, a.work_type,
    a.access_start_date, a.access_end_date
  from public.user_training_access a
  join public.users u on u.id = a.user_id
  left join public.vendors v on v.id = u.vendor_id
  where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
  limit 1
$$;


--
-- Name: get_my_supplier_outsource_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_my_supplier_outsource_status() RETURNS TABLE(participant_type text, work_type text, access_start_date date, access_end_date date, passed_at timestamp with time zone, expires_at timestamp with time zone, last_score integer, total_questions integer, last_status text, last_test_at timestamp with time zone, verification_token uuid)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select a.participant_type, a.work_type, a.access_start_date, a.access_end_date,
    a.passed_at, coalesce(pass_result.expires_at, a.expires_at),
    coalesce(pass_result.score, latest_result.score),
    coalesce(pass_result.total_questions, latest_result.total_questions),
    coalesce(pass_result.status, latest_result.status),
    coalesce(pass_result.test_date, latest_result.test_date),
    pass_result.verification_token
  from public.user_training_access a
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
  where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
$$;


--
-- Name: get_public_feature_flags(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_feature_flags() RETURNS TABLE(supplier_outsource_enabled boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select coalesce((
    select sc.value::boolean
    from public.system_config sc
    where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'
  ), false)
$$;


--
-- Name: get_public_registration_vendors(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_registration_vendors() RETURNS TABLE(id uuid, name text, status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select v.id, v.name, v.status
  from public.vendors v
  where v.status = 'APPROVED'
  order by v.name
$$;


--
-- Name: get_public_support_links(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_support_links() RETURNS TABLE(manual_url text, support_url text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select
    coalesce((select sc.value from public.system_config sc where sc.key = 'manual_url'), ''),
    coalesce((select sc.value from public.system_config sc where sc.key = 'support_url'), '')
$$;


--
-- Name: get_runtime_system_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_runtime_system_settings() RETURNS TABLE(key text, value text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Authentication required';
  end if;

  return query
  select sc.key, sc.value
  from public.system_config sc
  where sc.key in (
    'PASSING_SCORE_INDUCTION',
    'PASSING_SCORE_WORK_PERMIT',
    'PASSING_SCORE_SUPPLIER_OUTSOURCE',
    'SUPPLIER_OUTSOURCE_VALIDITY_DAYS',
    'manual_url',
    'support_url'
  );
end;
$$;


--
-- Name: guard_vendor_name_duplicates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_vendor_name_duplicates() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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


--
-- Name: initialize_user_auth_security(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.initialize_user_auth_security() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  insert into public.user_auth_security(user_id, pin_version)
  values (new.id, 1)
  on conflict (user_id) do nothing;
  return new;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'ADMIN'
  )
$$;


--
-- Name: link_my_line_identity(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.link_my_line_identity(line_user_id_param text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if line_user_id_param !~ '^U[0-9A-Fa-f]{32}$' then raise exception 'Invalid LINE user ID'; end if;
  update public.users set line_user_id = line_user_id_param where id = auth.uid();
end;
$_$;


--
-- Name: normalize_vendor_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_vendor_name(input_name text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO ''
    AS $$
  select lower(regexp_replace(btrim(coalesce(input_name, '')), '[[:space:][:punct:]]+', '', 'g'))
$$;


--
-- Name: protect_user_security_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_user_security_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.is_admin()
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.induction_expiry is distinct from old.induction_expiry
       or new.national_id is distinct from old.national_id
       or new.national_id_cipher is distinct from old.national_id_cipher
       or new.national_id_hash is distinct from old.national_id_hash
       or new.national_id_fingerprint is distinct from old.national_id_fingerprint
       or new.pdpa_agreed is distinct from old.pdpa_agreed
       or new.pdpa_agreed_at is distinct from old.pdpa_agreed_at
       or new.line_user_id is distinct from old.line_user_id
       or new.identity_merged_into_user_id is distinct from old.identity_merged_into_user_id
       or new.identity_archived_at is distinct from old.identity_archived_at
       or new.identity_archive_reason is distinct from old.identity_archive_reason
     ) then
    raise exception 'Protected user fields must be changed through an authorized RPC';
  end if;
  return new;
end;
$$;


--
-- Name: record_auth_login_failure(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_auth_login_failure(national_id_param text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  security_row public.user_auth_security%rowtype;
  next_attempts integer;
begin
  select s.* into security_row
  from public.user_auth_security s
  join public.users u on u.id = s.user_id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by exists (select 1 from auth.users au where au.id = u.id) desc,
           coalesce(u.pdpa_agreed, false) desc,
           u.created_at desc
  limit 1
  for update of s;

  if security_row.user_id is null then
    return jsonb_build_object('failed_attempts', 0, 'locked_until', null);
  end if;
  if security_row.locked_until is not null and security_row.locked_until > now() then
    return jsonb_build_object('failed_attempts', security_row.failed_attempts, 'locked_until', security_row.locked_until);
  end if;

  next_attempts := case
    when security_row.last_failed_at is null or security_row.last_failed_at < now() - interval '15 minutes' then 1
    else security_row.failed_attempts + 1
  end;

  update public.user_auth_security
  set failed_attempts = next_attempts,
      last_failed_at = now(),
      locked_until = case when next_attempts >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
  where user_id = security_row.user_id
  returning * into security_row;

  return jsonb_build_object(
    'failed_attempts', security_row.failed_attempts,
    'locked_until', security_row.locked_until
  );
end;
$_$;


--
-- Name: record_auth_login_success(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_auth_login_success(national_id_param text, pin_version_param integer DEFAULT 1) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  with target_user as (
    select u.id
    from public.users u
    where national_id_param ~ '^[0-9]{13}$'
      and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
    order by exists (select 1 from auth.users au where au.id = u.id) desc,
             coalesce(u.pdpa_agreed, false) desc,
             u.created_at desc
    limit 1
  )
  update public.user_auth_security s
  set failed_attempts = 0,
      last_failed_at = null,
      locked_until = null,
      pin_version = greatest(s.pin_version, case when pin_version_param = 2 then 2 else 1 end),
      pin_changed_at = case when pin_version_param = 2 and s.pin_version < 2 then now() else s.pin_changed_at end,
      updated_at = now()
  from target_user u
  where u.id = s.user_id;
end;
$_$;


--
-- Name: record_external_registration_email_result(uuid, text, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_external_registration_email_result(outbox_id_param uuid, tracking_token_param text, sent_param boolean, error_param text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  update public.external_registration_email_outbox o
  set status = case when coalesce(sent_param, false) then 'SENT' else 'FAILED' end,
      attempts = o.attempts + 1,
      last_error = case when coalesce(sent_param, false) then null else left(error_param, 1000) end,
      next_attempt_at = case when coalesce(sent_param, false) then null else now() + interval '5 minutes' end,
      sent_at = case when coalesce(sent_param, false) then now() else o.sent_at end,
      updated_at = now()
  where o.id = outbox_id_param
    and exists (
      select 1
      from public.external_access_applications a
      where a.id = o.application_id
        and a.tracking_token_hash = encode(extensions.digest(btrim(tracking_token_param), 'sha256'), 'hex')
    );

  if not found then raise exception 'Email record not found'; end if;
end;
$$;


--
-- Name: repair_my_orphaned_registration(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_my_orphaned_registration() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  auth_user_id uuid := auth.uid();
  auth_email text;
  national_id_value text;
  national_hash text;
  linked_user public.users%rowtype;
  orphaned_user public.users%rowtype;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;

  select lower(au.email) into auth_email
  from auth.users au
  where au.id = auth_user_id;

  if auth_email !~ '^[0-9]{13}@safetypass[.]com$' then
    raise exception 'Authenticated identity is not eligible for repair';
  end if;

  national_id_value := split_part(auth_email, '@', 1);
  national_hash := encode(extensions.digest(national_id_value, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(national_hash, 0));

  select u.* into linked_user
  from public.users u
  where u.id = auth_user_id
  for update;

  -- Idempotent success after a previous repair.
  if linked_user.id is not null then
    if linked_user.national_id_fingerprint = national_hash
       and coalesce(linked_user.pdpa_agreed, false)
       and coalesce(linked_user.is_active, false) then
      return true;
    end if;
    raise exception 'Authenticated profile does not match repair request';
  end if;

  select u.* into orphaned_user
  from public.users u
  where u.id <> auth_user_id
    and u.national_id_fingerprint = national_hash
    and coalesce(u.pdpa_agreed, false)
  order by u.created_at desc
  limit 1
  for update;

  if orphaned_user.id is null then raise exception 'Repairable profile not found'; end if;
  if orphaned_user.role <> 'USER' then raise exception 'Privileged profiles require administrator repair'; end if;
  if not coalesce(orphaned_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if exists (select 1 from auth.users au where au.id = orphaned_user.id) then
    raise exception 'Existing Auth identity cannot be replaced';
  end if;

  -- Release unique identity values on the old row, then clone the complete
  -- profile under auth.uid(). PROTECTED bypasses the encryption trigger while
  -- the saved cipher/hash/fingerprint values are preserved on the new row.
  update public.users
  set national_id_hash = null,
      national_id_fingerprint = null,
      national_id_cipher = null
  where id = orphaned_user.id;

  insert into public.users
  select (pg_catalog.jsonb_populate_record(
    null::public.users,
    pg_catalog.to_jsonb(orphaned_user) || pg_catalog.jsonb_build_object('id', auth_user_id)
  )).*;

  update public.exam_history set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.exam_logs set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.work_permits set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.user_training_access set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.supplier_outsource_passes set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.external_access_applications set reviewed_by = auth_user_id where reviewed_by = orphaned_user.id;
  update public.external_application_status_history set changed_by = auth_user_id where changed_by = orphaned_user.id;
  update public.external_registration_notification_recipients set created_by = auth_user_id where created_by = orphaned_user.id;

  delete from public.users where id = orphaned_user.id;

  insert into public.audit_logs(admin_email, action, target, details)
  values (
    auth_email,
    'ORPHANED_AUTH_PROFILE_REPAIRED',
    auth_user_id::text,
    pg_catalog.jsonb_build_object('profile_migrated', true)::text
  );

  return true;
end;
$_$;


--
-- Name: reset_my_induction(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_my_induction() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.users set induction_expiry = null where id = auth.uid();
end;
$$;


--
-- Name: resubmit_external_access_application(text, text, text, text[], text, text, text, text, text, text, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resubmit_external_access_application(request_no_param text, tracking_token_param text, company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  application_row public.external_access_applications%rowtype;
  normalized_company text := btrim(coalesce(company_name_param, ''));
  normalized_first_name_th text := btrim(coalesce(first_name_th_param, ''));
  normalized_last_name_th text := btrim(coalesce(last_name_th_param, ''));
  normalized_first_name_en text := btrim(coalesce(first_name_en_param, ''));
  normalized_last_name_en text := btrim(coalesce(last_name_en_param, ''));
  normalized_job_title text := btrim(coalesce(job_title_param, ''));
  normalized_email text := lower(btrim(coalesce(login_email_param, '')));
  normalized_phone text := btrim(coalesce(phone_param, ''));
  normalized_types text[];
  normalized_contacts text[];
  type_label text;
  coordinator_label text;
  applicant_name text;
  payload jsonb;
  applicant_payload jsonb;
begin
  select * into application_row
  from public.external_access_applications a
  where a.request_no = btrim(request_no_param)
    and a.tracking_token_hash = encode(extensions.digest(btrim(tracking_token_param), 'sha256'), 'hex')
  limit 1
  for update;

  if application_row.id is null then raise exception 'Application not found'; end if;
  if application_row.status not in ('NEED_MORE_INFO', 'REJECTED') then
    raise exception 'Application is not open for resubmission';
  end if;
  if length(normalized_company) not between 2 and 200 then raise exception 'Invalid company name'; end if;
  if length(normalized_first_name_th) not between 1 and 120 then raise exception 'Invalid Thai first name'; end if;
  if length(normalized_last_name_th) not between 1 and 120 then raise exception 'Invalid Thai last name'; end if;
  if length(normalized_first_name_en) not between 1 and 120 then raise exception 'Invalid English first name'; end if;
  if length(normalized_last_name_en) not between 1 and 120 then raise exception 'Invalid English last name'; end if;
  if length(normalized_job_title) not between 1 and 160 then raise exception 'Invalid job title'; end if;
  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Invalid email address'; end if;
  if length(normalized_email) > 320 then raise exception 'Email address is too long'; end if;
  if length(normalized_phone) not between 3 and 40 then raise exception 'Invalid phone number'; end if;

  select coalesce(array_agg(distinct upper(btrim(item.value))), '{}'::text[])
  into normalized_types
  from unnest(coalesce(requested_types_param, '{}'::text[])) as item(value)
  where btrim(item.value) <> '';
  if cardinality(normalized_types) = 0 then raise exception 'At least one user type is required'; end if;
  if exists (
    select 1 from unnest(normalized_types) as item(value)
    where item.value not in ('CONTRACTOR', 'SUPPLIER', 'OUTSOURCE')
  ) then raise exception 'Invalid user type'; end if;

  select coalesce(array_agg(btrim(item.value) order by item.ordinality) filter (where btrim(item.value) <> ''), '{}'::text[])
  into normalized_contacts
  from unnest(coalesce(coordinator_names_param, '{}'::text[])) with ordinality as item(value, ordinality);
  if cardinality(normalized_contacts) = 0 then raise exception 'At least one TSH coordinator is required'; end if;
  if exists (select 1 from unnest(normalized_contacts) as item(value) where length(item.value) > 160) then
    raise exception 'TSH coordinator name is too long';
  end if;

  applicant_name := normalized_first_name_th || ' ' || normalized_last_name_th;
  type_label := array_to_string(normalized_types, ', ');
  coordinator_label := array_to_string(normalized_contacts, ', ');

  update public.external_access_applications
  set company_name_submitted = normalized_company,
      first_name_th = normalized_first_name_th,
      last_name_th = normalized_last_name_th,
      first_name_en = normalized_first_name_en,
      last_name_en = normalized_last_name_en,
      job_title = normalized_job_title,
      login_email = normalized_email,
      phone = normalized_phone,
      vendor_id = null,
      company_resolution = 'UNRESOLVED',
      status = 'SUBMITTED',
      admin_note = null,
      rejection_reason = null,
      reviewed_by = null,
      reviewed_at = null,
      submitted_at = now()
  where id = application_row.id;

  delete from public.external_application_types where application_id = application_row.id;
  insert into public.external_application_types(application_id, type_code, target_system)
  select application_row.id, item.value,
    case when item.value = 'CONTRACTOR' then 'CONTRACTOR_ONLINE' else 'SUPPLIER_EPASS' end
  from unnest(normalized_types) as item(value);

  delete from public.external_application_contacts where application_id = application_row.id;
  insert into public.external_application_contacts(application_id, contact_name, is_primary, display_order)
  select application_row.id, item.value, item.ordinality = 1, item.ordinality
  from unnest(normalized_contacts) with ordinality as item(value, ordinality);

  insert into public.external_application_status_history(application_id, from_status, to_status, note)
  values (application_row.id, application_row.status, 'SUBMITTED', 'Applicant resubmitted updated information');

  payload := jsonb_build_object(
    'requestNo', application_row.request_no,
    'companyName', normalized_company,
    'applicantName', applicant_name,
    'applicantNameEnglish', normalized_first_name_en || ' ' || normalized_last_name_en,
    'jobTitle', normalized_job_title,
    'types', type_label,
    'email', normalized_email,
    'phone', normalized_phone,
    'coordinators', coordinator_label
  );
  applicant_payload := payload || jsonb_build_object('trackingToken', btrim(tracking_token_param));

  insert into public.external_registration_email_outbox(
    application_id, template_key, recipient_email, recipient_name, payload
  )
  select application_row.id, 'external_registration_admin_notice', r.email, r.display_name, payload
  from public.external_registration_notification_recipients r
  where r.purpose = 'EXTERNAL_REGISTRATION_ADMIN' and r.is_active;

  insert into public.external_registration_email_outbox(
    application_id, template_key, recipient_email, recipient_name, payload
  ) values (
    application_row.id, 'external_registration_applicant_received', normalized_email,
    applicant_name, applicant_payload
  );

  return jsonb_build_object(
    'request_no', application_row.request_no,
    'status', 'SUBMITTED'
  );
end;
$_$;


--
-- Name: submit_safety_exam(text, jsonb, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.submit_safety_exam(exam_type_param text, answers_param jsonb, permit_no_param text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare
  question_record record;
  choice_record record;
  answer_value jsonb;
  score_value integer := 0;
  total_value integer := 0;
  threshold_value numeric := 80;
  validity_days integer := 365;
  passed_value boolean;
  result_map jsonb := '{}'::jsonb;
  correct_value boolean;
  history_id uuid;
  pass_token uuid;
  pass_expiry timestamptz;
  access_end date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.users where id = auth.uid() and coalesce(is_active, false)) then
    raise exception 'Account is unavailable';
  end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if exists (select 1 from public.exam_history where user_id = auth.uid()
    and exam_type = exam_type_param and created_at >= now() - interval '60 seconds') then
    raise exception 'Please wait before submitting another exam';
  end if;
  if exam_type_param = 'WORK_PERMIT' and not exists (
    select 1 from public.users where id = auth.uid() and induction_expiry > now()
  ) then raise exception 'Valid induction is required'; end if;
  if exam_type_param = 'WORK_PERMIT' and (permit_no_param is null or permit_no_param !~ '^[0-9]{10}$') then
    raise exception 'Invalid permit number';
  end if;
  if exam_type_param = 'SUPPLIER_OUTSOURCE' then
    if not coalesce((select sc.value::boolean from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'), false) then
      raise exception 'Program is not enabled';
    end if;
    if (select count(*) from public.questions q where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active) < 20 then
      raise exception 'At least 20 active Supplier and Outsource questions are required';
    end if;
    select a.access_end_date into access_end from public.user_training_access a
    where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
      and (a.access_start_date is null or a.access_start_date <= current_date)
      and (a.access_end_date is null or a.access_end_date >= current_date);
    if not found then raise exception 'Supplier and Outsource access is required'; end if;
  end if;

  select coalesce(value::numeric, 80) into threshold_value from public.system_config
  where key = case exam_type_param
    when 'INDUCTION' then 'PASSING_SCORE_INDUCTION'
    when 'WORK_PERMIT' then 'PASSING_SCORE_WORK_PERMIT'
    else 'PASSING_SCORE_SUPPLIER_OUTSOURCE' end;

  for question_record in
    select * from public.questions
    where type = exam_type_param and is_active = true
    order by created_at, id
    limit (case when exam_type_param = 'SUPPLIER_OUTSOURCE' then 20 else 2147483647 end)
  loop
    total_value := total_value + 1;
    answer_value := answers_param -> question_record.id::text;
    correct_value := false;
    if answer_value is not null then
      if question_record.pattern = 'SHORT_ANSWER' then
        correct_value := lower(trim(answer_value #>> '{}')) = lower(trim(question_record.choices_json -> 0 ->> 'correct_answer'));
      elsif question_record.pattern = 'MATCHING' then
        correct_value := true;
        for choice_record in select value, ordinality
          from jsonb_array_elements(question_record.choices_json) with ordinality x(value, ordinality)
        loop
          if coalesce((answer_value ->> (choice_record.ordinality - 1)::text)::integer, -1)
             <> choice_record.ordinality - 1 then correct_value := false; end if;
        end loop;
      else
        correct_value := coalesce((answer_value #>> '{}')::integer, -1) = question_record.correct_choice_index;
      end if;
    end if;
    if correct_value then score_value := score_value + 1; end if;
    result_map := result_map || jsonb_build_object(question_record.id::text, correct_value);
  end loop;
  if total_value = 0 then raise exception 'No active questions'; end if;
  passed_value := score_value::numeric * 100 / total_value >= threshold_value;

  insert into public.exam_history(user_id, exam_type, score, total_questions, status)
  values (auth.uid(), exam_type_param, score_value, total_value,
    case when passed_value then 'PASSED' else 'FAILED' end)
  returning id into history_id;
  insert into public.exam_logs(user_id, exam_type, score, passed)
  values (auth.uid(), exam_type_param, score_value, passed_value);

  if passed_value and exam_type_param = 'INDUCTION' then
    update public.users set induction_expiry = date_trunc('day', now()) + interval '1 year 1 day - 1 millisecond'
    where id = auth.uid();
  elsif passed_value and exam_type_param = 'WORK_PERMIT' then
    update public.work_permits set status = 'EXPIRED' where user_id = auth.uid() and status = 'ACTIVE';
    insert into public.work_permits(user_id, permit_no, expire_date, status)
    values (auth.uid(), permit_no_param, date_trunc('day', now()) + interval '5 days - 1 millisecond', 'ACTIVE');
  elsif passed_value and exam_type_param = 'SUPPLIER_OUTSOURCE' then
    select greatest(1, least(3650, coalesce(value::integer, 365))) into validity_days
    from public.system_config where key = 'SUPPLIER_OUTSOURCE_VALIDITY_DAYS';
    pass_expiry := date_trunc('day', now()) + make_interval(days => validity_days) + interval '1 day - 1 millisecond';
    if access_end is not null then
      pass_expiry := least(pass_expiry, access_end::timestamptz + interval '1 day - 1 millisecond');
    end if;
    update public.supplier_outsource_passes set status = 'REVOKED'
    where user_id = auth.uid() and status = 'ACTIVE';
    insert into public.supplier_outsource_passes(user_id, exam_history_id, issued_at, expires_at)
    values (auth.uid(), history_id, now(), pass_expiry)
    returning verification_token into pass_token;
    update public.user_training_access set passed_at = now(), expires_at = pass_expiry, updated_at = now()
    where user_id = auth.uid() and program_code = 'SUPPLIER_OUTSOURCE';
  end if;

  return jsonb_build_object('score', score_value, 'passed', passed_value,
    'perQuestion', result_map, 'verificationToken', pass_token, 'expiresAt', pass_expiry);
end;
$_$;


--
-- Name: verify_induction_pass(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_induction_pass(national_id_param text) RETURNS TABLE(name text, vendor_name text, masked_national_id text, induction_expiry timestamp with time zone, is_active boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  select
    u.name,
    v.name,
    case when national_id_param ~ '^[0-9]{13}$' then
      substring(national_id_param from 1 for 1) || '-' ||
      substring(national_id_param from 2 for 4) || '-XXXXX-' ||
      substring(national_id_param from 11 for 2) || '-' ||
      substring(national_id_param from 13 for 1)
    else null end,
    u.induction_expiry,
    coalesce(u.is_active, false)
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by
    (coalesce(u.is_active, false) and u.induction_expiry > now()) desc nulls last,
    u.induction_expiry desc nulls last,
    u.created_at desc
  limit 1
$_$;


--
-- Name: verify_safety_pass(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_safety_pass(permit_no_param text) RETURNS TABLE(name text, vendor_name text, permit_no text, expire_date timestamp with time zone, is_active boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.name, v.name, p.permit_no, p.expire_date,
    coalesce(u.is_active, false) and p.status = 'ACTIVE' and p.expire_date > now()
  from public.work_permits p
  join public.users u on u.id = p.user_id
  left join public.vendors v on v.id = u.vendor_id
  where p.permit_no = permit_no_param
  order by p.created_at desc
  limit 1
$$;


--
-- Name: verify_supplier_outsource_pass(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_supplier_outsource_pass(token_param uuid) RETURNS TABLE(name text, vendor_name text, participant_type text, work_type text, score integer, total_questions integer, test_date timestamp with time zone, expires_at timestamp with time zone, is_active boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  select u.name, v.name, a.participant_type, a.work_type, h.score, h.total_questions,
    h.created_at, p.expires_at,
    coalesce(u.is_active, false)
      and p.status = 'ACTIVE'
      and p.expires_at > now()
      and (a.access_start_date is null or a.access_start_date <= current_date)
      and (a.access_end_date is null or a.access_end_date >= current_date)
  from public.supplier_outsource_passes p
  join public.users u on u.id = p.user_id
  join public.user_training_access a
    on a.user_id = p.user_id and a.program_code = 'SUPPLIER_OUTSOURCE'
  join public.exam_history h on h.id = p.exam_history_id
  left join public.vendors v on v.id = u.vendor_id
  where p.verification_token = token_param
  limit 1
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_email text,
    action text,
    target text,
    details text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exam_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    exam_type text NOT NULL,
    score integer NOT NULL,
    total_questions integer NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: exam_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.exam_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    exam_type text NOT NULL,
    score integer NOT NULL,
    passed boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    note text
);


--
-- Name: external_access_request_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.external_access_request_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: external_access_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_access_applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    request_no text DEFAULT ((('EXT-'::text || to_char((CURRENT_DATE)::timestamp with time zone, 'YYYY'::text)) || '-'::text) || lpad((nextval('public.external_access_request_seq'::regclass))::text, 6, '0'::text)) NOT NULL,
    company_name_submitted text NOT NULL,
    vendor_id uuid,
    company_resolution text DEFAULT 'UNRESOLVED'::text NOT NULL,
    first_name_th text NOT NULL,
    last_name_th text NOT NULL,
    first_name_en text NOT NULL,
    last_name_en text NOT NULL,
    job_title text NOT NULL,
    login_email text NOT NULL,
    phone text NOT NULL,
    status text DEFAULT 'SUBMITTED'::text NOT NULL,
    pdpa_agreed boolean DEFAULT false NOT NULL,
    pdpa_agreed_at timestamp with time zone,
    tracking_token_hash text NOT NULL,
    admin_note text,
    rejection_reason text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_access_applications_check CHECK (((NOT pdpa_agreed) OR (pdpa_agreed_at IS NOT NULL))),
    CONSTRAINT external_access_applications_company_name_submitted_check CHECK (((length(btrim(company_name_submitted)) >= 2) AND (length(btrim(company_name_submitted)) <= 200))),
    CONSTRAINT external_access_applications_company_resolution_check CHECK ((company_resolution = ANY (ARRAY['UNRESOLVED'::text, 'MATCHED_EXISTING'::text, 'LINKED_PENDING'::text, 'CREATED_NEW'::text, 'REJECTED'::text]))),
    CONSTRAINT external_access_applications_first_name_en_check CHECK (((length(btrim(first_name_en)) >= 1) AND (length(btrim(first_name_en)) <= 120))),
    CONSTRAINT external_access_applications_first_name_th_check CHECK (((length(btrim(first_name_th)) >= 1) AND (length(btrim(first_name_th)) <= 120))),
    CONSTRAINT external_access_applications_job_title_check CHECK (((length(btrim(job_title)) >= 1) AND (length(btrim(job_title)) <= 160))),
    CONSTRAINT external_access_applications_last_name_en_check CHECK (((length(btrim(last_name_en)) >= 1) AND (length(btrim(last_name_en)) <= 120))),
    CONSTRAINT external_access_applications_last_name_th_check CHECK (((length(btrim(last_name_th)) >= 1) AND (length(btrim(last_name_th)) <= 120))),
    CONSTRAINT external_access_applications_login_email_check CHECK (((length(btrim(login_email)) >= 3) AND (length(btrim(login_email)) <= 320))),
    CONSTRAINT external_access_applications_phone_check CHECK (((length(btrim(phone)) >= 3) AND (length(btrim(phone)) <= 40))),
    CONSTRAINT external_access_applications_status_check CHECK ((status = ANY (ARRAY['SUBMITTED'::text, 'UNDER_REVIEW'::text, 'NEED_MORE_INFO'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);


--
-- Name: external_application_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_application_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    contact_name text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    display_order integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_application_contacts_contact_name_check CHECK (((length(btrim(contact_name)) >= 1) AND (length(btrim(contact_name)) <= 160)))
);


--
-- Name: external_application_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_application_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    changed_by uuid,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_application_status_history_to_status_check CHECK ((to_status = ANY (ARRAY['SUBMITTED'::text, 'UNDER_REVIEW'::text, 'NEED_MORE_INFO'::text, 'APPROVED'::text, 'REJECTED'::text, 'CANCELLED'::text])))
);


--
-- Name: external_application_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_application_types (
    application_id uuid NOT NULL,
    type_code text NOT NULL,
    target_system text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_application_types_check CHECK ((((type_code = 'CONTRACTOR'::text) AND (target_system = 'CONTRACTOR_ONLINE'::text)) OR ((type_code = ANY (ARRAY['SUPPLIER'::text, 'OUTSOURCE'::text])) AND (target_system = 'SUPPLIER_EPASS'::text)))),
    CONSTRAINT external_application_types_target_system_check CHECK ((target_system = ANY (ARRAY['CONTRACTOR_ONLINE'::text, 'SUPPLIER_EPASS'::text]))),
    CONSTRAINT external_application_types_type_code_check CHECK ((type_code = ANY (ARRAY['CONTRACTOR'::text, 'SUPPLIER'::text, 'OUTSOURCE'::text])))
);


--
-- Name: external_registration_email_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_registration_email_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid,
    template_key text NOT NULL,
    recipient_email text NOT NULL,
    recipient_name text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    next_attempt_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_registration_email_outbox_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT external_registration_email_outbox_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'SENT'::text, 'FAILED'::text])))
);


--
-- Name: external_registration_notification_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_registration_notification_recipients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    display_name text,
    email text NOT NULL,
    purpose text DEFAULT 'EXTERNAL_REGISTRATION_ADMIN'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT external_registration_notification_recipients_email_check CHECK ((email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'::text)),
    CONSTRAINT external_registration_notification_recipients_purpose_check CHECK ((purpose = 'EXTERNAL_REGISTRATION_ADMIN'::text))
);


--
-- Name: question_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.question_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    question_id uuid NOT NULL,
    revision_no integer NOT NULL,
    snapshot jsonb NOT NULL,
    change_type text NOT NULL,
    note text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT question_revisions_change_type_check CHECK ((change_type = ANY (ARRAY['BASELINE'::text, 'CREATE'::text, 'SAVE'::text, 'PUBLISH'::text, 'UNPUBLISH'::text, 'RESTORE'::text])))
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    content_th text NOT NULL,
    content_en text NOT NULL,
    choices_json jsonb NOT NULL,
    correct_choice_index integer NOT NULL,
    type text DEFAULT 'MULTIPLE_CHOICE'::text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    image_url text,
    pattern text DEFAULT 'MULTIPLE_CHOICE'::text,
    CONSTRAINT check_question_pattern CHECK ((pattern = ANY (ARRAY['MULTIPLE_CHOICE'::text, 'TRUE_FALSE'::text, 'MATCHING'::text, 'SHORT_ANSWER'::text])))
);


--
-- Name: supplier_outsource_passes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_outsource_passes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    verification_token uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    exam_history_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supplier_outsource_passes_check CHECK ((expires_at > issued_at)),
    CONSTRAINT supplier_outsource_passes_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: user_auth_security; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_auth_security (
    user_id uuid NOT NULL,
    pin_version smallint DEFAULT 1 NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    last_failed_at timestamp with time zone,
    locked_until timestamp with time zone,
    pin_changed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_auth_security_failed_attempts_check CHECK ((failed_attempts >= 0)),
    CONSTRAINT user_auth_security_pin_version_check CHECK ((pin_version = ANY (ARRAY[1, 2])))
);


--
-- Name: user_training_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_training_access (
    user_id uuid NOT NULL,
    program_code text NOT NULL,
    participant_type text,
    work_type text,
    passed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    access_start_date date,
    access_end_date date,
    CONSTRAINT user_training_access_access_dates_check CHECK (((access_end_date IS NULL) OR (access_start_date IS NULL) OR (access_end_date >= access_start_date))),
    CONSTRAINT user_training_access_expiry_check CHECK (((expires_at IS NULL) OR (passed_at IS NULL) OR (expires_at > passed_at))),
    CONSTRAINT user_training_access_participant_check CHECK (((participant_type IS NULL) OR (participant_type = ANY (ARRAY['supplier'::text, 'outsource'::text])))),
    CONSTRAINT user_training_access_program_check CHECK ((program_code = ANY (ARRAY['CONTRACTOR'::text, 'SUPPLIER_OUTSOURCE'::text]))),
    CONSTRAINT user_training_access_program_fields_check CHECK (((program_code = 'SUPPLIER_OUTSOURCE'::text) OR ((participant_type IS NULL) AND (work_type IS NULL) AND (passed_at IS NULL) AND (expires_at IS NULL)))),
    CONSTRAINT user_training_access_work_type_check CHECK (((work_type IS NULL) OR (work_type = ANY (ARRAY['Driver'::text, 'Passenger'::text, 'Trainee'::text]))))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    national_id text NOT NULL,
    name text NOT NULL,
    vendor_id uuid,
    role text DEFAULT 'USER'::text,
    induction_expiry timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    age integer DEFAULT 0,
    nationality text DEFAULT 'ไทย (Thai)'::text,
    pdpa_agreed boolean DEFAULT false,
    pdpa_agreed_at timestamp with time zone,
    national_id_cipher text,
    national_id_hash text,
    is_active boolean DEFAULT true,
    date_of_birth date,
    avatar_url text,
    last_login timestamp with time zone,
    national_id_fingerprint text,
    line_user_id text,
    identity_merged_into_user_id uuid,
    identity_archived_at timestamp with time zone,
    identity_archive_reason text,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'USER'::text])))
);


--
-- Name: COLUMN users.identity_merged_into_user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.identity_merged_into_user_id IS 'Auth-linked canonical profile when this row was archived as a duplicate identity.';


--
-- Name: COLUMN users.identity_archived_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.identity_archived_at IS 'Timestamp when this duplicate identity was removed from login lookup.';


--
-- Name: COLUMN users.identity_archive_reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.users.identity_archive_reason IS 'Machine-readable reason for archiving the profile.';


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vendors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'PENDING'::text,
    created_at timestamp with time zone DEFAULT now(),
    remark text,
    normalized_name text,
    CONSTRAINT check_vendor_status CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text]))),
    CONSTRAINT vendors_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text])))
);


--
-- Name: work_permits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.work_permits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    permit_no text NOT NULL,
    expire_date timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    status text DEFAULT 'ACTIVE'::text
);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: exam_history exam_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_history
    ADD CONSTRAINT exam_history_pkey PRIMARY KEY (id);


--
-- Name: exam_logs exam_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_logs
    ADD CONSTRAINT exam_logs_pkey PRIMARY KEY (id);


--
-- Name: external_access_applications external_access_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_access_applications
    ADD CONSTRAINT external_access_applications_pkey PRIMARY KEY (id);


--
-- Name: external_access_applications external_access_applications_request_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_access_applications
    ADD CONSTRAINT external_access_applications_request_no_key UNIQUE (request_no);


--
-- Name: external_access_applications external_access_applications_tracking_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_access_applications
    ADD CONSTRAINT external_access_applications_tracking_token_hash_key UNIQUE (tracking_token_hash);


--
-- Name: external_application_contacts external_application_contacts_application_id_display_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_contacts
    ADD CONSTRAINT external_application_contacts_application_id_display_order_key UNIQUE (application_id, display_order);


--
-- Name: external_application_contacts external_application_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_contacts
    ADD CONSTRAINT external_application_contacts_pkey PRIMARY KEY (id);


--
-- Name: external_application_status_history external_application_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_status_history
    ADD CONSTRAINT external_application_status_history_pkey PRIMARY KEY (id);


--
-- Name: external_application_types external_application_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_types
    ADD CONSTRAINT external_application_types_pkey PRIMARY KEY (application_id, type_code);


--
-- Name: external_registration_email_outbox external_registration_email_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_registration_email_outbox
    ADD CONSTRAINT external_registration_email_outbox_pkey PRIMARY KEY (id);


--
-- Name: external_registration_notification_recipients external_registration_notification_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_registration_notification_recipients
    ADD CONSTRAINT external_registration_notification_recipients_pkey PRIMARY KEY (id);


--
-- Name: question_revisions question_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_revisions
    ADD CONSTRAINT question_revisions_pkey PRIMARY KEY (id);


--
-- Name: question_revisions question_revisions_revision_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_revisions
    ADD CONSTRAINT question_revisions_revision_unique UNIQUE (question_id, revision_no);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: supplier_outsource_passes supplier_outsource_passes_exam_history_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_outsource_passes
    ADD CONSTRAINT supplier_outsource_passes_exam_history_id_key UNIQUE (exam_history_id);


--
-- Name: supplier_outsource_passes supplier_outsource_passes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_outsource_passes
    ADD CONSTRAINT supplier_outsource_passes_pkey PRIMARY KEY (id);


--
-- Name: supplier_outsource_passes supplier_outsource_passes_verification_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_outsource_passes
    ADD CONSTRAINT supplier_outsource_passes_verification_token_key UNIQUE (verification_token);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (key);


--
-- Name: user_auth_security user_auth_security_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_auth_security
    ADD CONSTRAINT user_auth_security_pkey PRIMARY KEY (user_id);


--
-- Name: user_training_access user_training_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_training_access
    ADD CONSTRAINT user_training_access_pkey PRIMARY KEY (user_id, program_code);


--
-- Name: users users_national_id_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_national_id_hash_key UNIQUE (national_id_hash);


--
-- Name: users users_national_id_hash_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_national_id_hash_unique UNIQUE (national_id_hash);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: work_permits work_permits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_permits
    ADD CONSTRAINT work_permits_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_logs_created_at_idx ON public.audit_logs USING btree (created_at DESC);


--
-- Name: exam_history_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_history_created_at_idx ON public.exam_history USING btree (created_at DESC);


--
-- Name: exam_history_type_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX exam_history_type_status_created_idx ON public.exam_history USING btree (exam_type, status, created_at DESC);


--
-- Name: external_access_applications_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_access_applications_email_idx ON public.external_access_applications USING btree (lower(login_email));


--
-- Name: external_access_applications_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_access_applications_status_idx ON public.external_access_applications USING btree (status, created_at DESC);


--
-- Name: external_access_applications_vendor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_access_applications_vendor_idx ON public.external_access_applications USING btree (vendor_id, created_at DESC);


--
-- Name: external_application_contacts_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_application_contacts_application_idx ON public.external_application_contacts USING btree (application_id, display_order);


--
-- Name: external_application_status_history_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_application_status_history_application_idx ON public.external_application_status_history USING btree (application_id, created_at DESC);


--
-- Name: external_application_types_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_application_types_type_idx ON public.external_application_types USING btree (type_code, application_id);


--
-- Name: external_registration_email_outbox_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_registration_email_outbox_status_idx ON public.external_registration_email_outbox USING btree (status, next_attempt_at, created_at);


--
-- Name: external_registration_recipients_email_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX external_registration_recipients_email_unique_idx ON public.external_registration_notification_recipients USING btree (lower(email), purpose);


--
-- Name: idx_users_national_id_fingerprint; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_national_id_fingerprint ON public.users USING btree (national_id_fingerprint);


--
-- Name: idx_users_national_id_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_users_national_id_hash ON public.users USING btree (national_id_hash);


--
-- Name: question_revisions_question_changed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX question_revisions_question_changed_idx ON public.question_revisions USING btree (question_id, changed_at DESC);


--
-- Name: supplier_outsource_passes_active_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_outsource_passes_active_expiry_idx ON public.supplier_outsource_passes USING btree (expires_at) WHERE (status = 'ACTIVE'::text);


--
-- Name: supplier_outsource_passes_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX supplier_outsource_passes_user_idx ON public.supplier_outsource_passes USING btree (user_id, issued_at DESC);


--
-- Name: user_training_access_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_training_access_expiry_idx ON public.user_training_access USING btree (expires_at) WHERE (expires_at IS NOT NULL);


--
-- Name: user_training_access_program_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_training_access_program_idx ON public.user_training_access USING btree (program_code);


--
-- Name: users_line_user_id_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_line_user_id_unique_idx ON public.users USING btree (line_user_id) WHERE (line_user_id IS NOT NULL);


--
-- Name: users_national_id_fingerprint_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_national_id_fingerprint_unique ON public.users USING btree (national_id_fingerprint) WHERE (national_id_fingerprint IS NOT NULL);


--
-- Name: users_vendor_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_vendor_created_idx ON public.users USING btree (vendor_id, created_at DESC);


--
-- Name: vendors_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_created_at_idx ON public.vendors USING btree (created_at DESC);


--
-- Name: vendors_normalized_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vendors_normalized_name_idx ON public.vendors USING btree (normalized_name);


--
-- Name: users trg_audit_admin_user_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_admin_user_mutation AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.audit_admin_directory_mutation();


--
-- Name: vendors trg_audit_admin_vendor_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_audit_admin_vendor_mutation AFTER INSERT OR DELETE OR UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.audit_admin_directory_mutation();


--
-- Name: external_access_applications trg_external_access_applications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_external_access_applications_updated_at BEFORE UPDATE ON public.external_access_applications FOR EACH ROW EXECUTE FUNCTION public.external_registration_set_updated_at();


--
-- Name: external_registration_email_outbox trg_external_registration_email_outbox_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_external_registration_email_outbox_updated_at BEFORE UPDATE ON public.external_registration_email_outbox FOR EACH ROW EXECUTE FUNCTION public.external_registration_set_updated_at();


--
-- Name: external_access_applications trg_external_registration_queue_followup_email; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_external_registration_queue_followup_email AFTER UPDATE OF status ON public.external_access_applications FOR EACH ROW EXECUTE FUNCTION public.external_registration_queue_followup_email();


--
-- Name: external_registration_notification_recipients trg_external_registration_recipients_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_external_registration_recipients_updated_at BEFORE UPDATE ON public.external_registration_notification_recipients FOR EACH ROW EXECUTE FUNCTION public.external_registration_set_updated_at();


--
-- Name: users trg_initialize_user_auth_security; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_initialize_user_auth_security AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.initialize_user_auth_security();


--
-- Name: users trg_protect_user_security_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_protect_user_security_fields BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.protect_user_security_fields();


--
-- Name: vendors vendors_name_duplicate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER vendors_name_duplicate_guard BEFORE INSERT OR UPDATE OF name ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.guard_vendor_name_duplicates();


--
-- Name: exam_history exam_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_history
    ADD CONSTRAINT exam_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: exam_logs exam_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.exam_logs
    ADD CONSTRAINT exam_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: external_access_applications external_access_applications_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_access_applications
    ADD CONSTRAINT external_access_applications_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: external_access_applications external_access_applications_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_access_applications
    ADD CONSTRAINT external_access_applications_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: external_application_contacts external_application_contacts_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_contacts
    ADD CONSTRAINT external_application_contacts_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.external_access_applications(id) ON DELETE CASCADE;


--
-- Name: external_application_status_history external_application_status_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_status_history
    ADD CONSTRAINT external_application_status_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.external_access_applications(id) ON DELETE CASCADE;


--
-- Name: external_application_status_history external_application_status_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_status_history
    ADD CONSTRAINT external_application_status_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: external_application_types external_application_types_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_application_types
    ADD CONSTRAINT external_application_types_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.external_access_applications(id) ON DELETE CASCADE;


--
-- Name: external_registration_email_outbox external_registration_email_outbox_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_registration_email_outbox
    ADD CONSTRAINT external_registration_email_outbox_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.external_access_applications(id) ON DELETE CASCADE;


--
-- Name: external_registration_notification_recipients external_registration_notification_recipients_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_registration_notification_recipients
    ADD CONSTRAINT external_registration_notification_recipients_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: question_revisions question_revisions_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.question_revisions
    ADD CONSTRAINT question_revisions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE;


--
-- Name: supplier_outsource_passes supplier_outsource_passes_exam_history_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_outsource_passes
    ADD CONSTRAINT supplier_outsource_passes_exam_history_id_fkey FOREIGN KEY (exam_history_id) REFERENCES public.exam_history(id) ON DELETE CASCADE;


--
-- Name: supplier_outsource_passes supplier_outsource_passes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_outsource_passes
    ADD CONSTRAINT supplier_outsource_passes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_auth_security user_auth_security_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_auth_security
    ADD CONSTRAINT user_auth_security_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_training_access user_training_access_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_training_access
    ADD CONSTRAINT user_training_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_identity_merged_into_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_identity_merged_into_user_id_fkey FOREIGN KEY (identity_merged_into_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: users users_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: work_permits work_permits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.work_permits
    ADD CONSTRAINT work_permits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit_logs audit_admin_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_admin_only ON public.audit_logs TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: system_config config_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_select_authenticated ON public.system_config FOR SELECT TO authenticated USING (true);


--
-- Name: system_config config_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY config_write_admin ON public.system_config TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: exam_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_history ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.exam_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: external_access_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_access_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: external_application_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_application_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: external_application_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_application_status_history ENABLE ROW LEVEL SECURITY;

--
-- Name: external_application_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_application_types ENABLE ROW LEVEL SECURITY;

--
-- Name: external_registration_email_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_registration_email_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: external_registration_notification_recipients; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_registration_notification_recipients ENABLE ROW LEVEL SECURITY;

--
-- Name: exam_history history_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY history_select_own_or_admin ON public.exam_history FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: exam_history history_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY history_write_admin ON public.exam_history TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: exam_logs logs_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY logs_select_own_or_admin ON public.exam_logs FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: exam_logs logs_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY logs_write_admin ON public.exam_logs TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: work_permits permits_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permits_select_own_or_admin ON public.work_permits FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: work_permits permits_write_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permits_write_admin ON public.work_permits TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: question_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.question_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: question_revisions question_revisions_admin_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY question_revisions_admin_only ON public.question_revisions TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

--
-- Name: questions questions_admin_only; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY questions_admin_only ON public.questions TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: supplier_outsource_passes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supplier_outsource_passes ENABLE ROW LEVEL SECURITY;

--
-- Name: supplier_outsource_passes supplier_pass_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_pass_admin_update ON public.supplier_outsource_passes FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: supplier_outsource_passes supplier_pass_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_pass_select_own_or_admin ON public.supplier_outsource_passes FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: system_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

--
-- Name: user_training_access training_access_admin_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY training_access_admin_delete ON public.user_training_access FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: user_training_access training_access_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY training_access_admin_insert ON public.user_training_access FOR INSERT TO authenticated WITH CHECK (public.is_admin());


--
-- Name: user_training_access training_access_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY training_access_admin_update ON public.user_training_access FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: user_training_access training_access_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY training_access_select_own_or_admin ON public.user_training_access FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR public.is_admin()));


--
-- Name: user_auth_security; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_auth_security ENABLE ROW LEVEL SECURITY;

--
-- Name: user_training_access; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_training_access ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_delete_admin ON public.users FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: users users_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own ON public.users FOR INSERT TO authenticated WITH CHECK ((id = auth.uid()));


--
-- Name: users users_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_select_own_or_admin ON public.users FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.is_admin()));


--
-- Name: users users_update_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own_or_admin ON public.users FOR UPDATE TO authenticated USING (((id = auth.uid()) OR public.is_admin())) WITH CHECK (((id = auth.uid()) OR public.is_admin()));


--
-- Name: vendors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

--
-- Name: vendors vendors_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendors_delete_admin ON public.vendors FOR DELETE TO authenticated USING (public.is_admin());


--
-- Name: vendors vendors_insert_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendors_insert_authenticated ON public.vendors FOR INSERT TO authenticated WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: vendors vendors_select_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendors_select_public ON public.vendors FOR SELECT USING (((status = 'APPROVED'::text) OR public.is_admin()));


--
-- Name: vendors vendors_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vendors_update_admin ON public.vendors FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: work_permits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.work_permits ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION add_my_supplier_outsource_access(participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_my_supplier_outsource_access(participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_my_supplier_outsource_access(participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO service_role;
GRANT ALL ON FUNCTION public.add_my_supplier_outsource_access(participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO authenticated;


--
-- Name: FUNCTION add_my_training_access(program_codes text[], participant_type_param text, work_type_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.add_my_training_access(program_codes text[], participant_type_param text, work_type_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.add_my_training_access(program_codes text[], participant_type_param text, work_type_param text) TO service_role;


--
-- Name: FUNCTION admin_archive_user(user_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_archive_user(user_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_archive_user(user_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_archive_user(user_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_archive_vendor(vendor_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_archive_vendor(vendor_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_archive_vendor(vendor_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_archive_vendor(vendor_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_delete_external_access_application(application_id_param uuid, delete_reason_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_external_access_application(application_id_param uuid, delete_reason_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_external_access_application(application_id_param uuid, delete_reason_param text) TO service_role;
GRANT ALL ON FUNCTION public.admin_delete_external_access_application(application_id_param uuid, delete_reason_param text) TO authenticated;


--
-- Name: FUNCTION admin_delete_question(question_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_delete_question(question_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_delete_question(question_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_delete_question(question_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_get_dashboard_summary(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_dashboard_summary() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_dashboard_summary() TO service_role;
GRANT ALL ON FUNCTION public.admin_get_dashboard_summary() TO authenticated;


--
-- Name: FUNCTION admin_get_directory_page(p_section text, p_page integer, p_page_size integer, p_search text, p_vendor_filter text, p_cert_filter text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_directory_page(p_section text, p_page integer, p_page_size integer, p_search text, p_vendor_filter text, p_cert_filter text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_directory_page(p_section text, p_page integer, p_page_size integer, p_search text, p_vendor_filter text, p_cert_filter text) TO service_role;
GRANT ALL ON FUNCTION public.admin_get_directory_page(p_section text, p_page integer, p_page_size integer, p_search text, p_vendor_filter text, p_cert_filter text) TO authenticated;


--
-- Name: FUNCTION admin_get_exam_history(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_exam_history() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_exam_history() TO service_role;
GRANT ALL ON FUNCTION public.admin_get_exam_history() TO authenticated;


--
-- Name: FUNCTION admin_get_exam_history_page(p_page integer, p_page_size integer, p_search text, p_exam_type text, p_status text, p_date date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_exam_history_page(p_page integer, p_page_size integer, p_search text, p_exam_type text, p_status text, p_date date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_exam_history_page(p_page integer, p_page_size integer, p_search text, p_exam_type text, p_status text, p_date date) TO service_role;
GRANT ALL ON FUNCTION public.admin_get_exam_history_page(p_page integer, p_page_size integer, p_search text, p_exam_type text, p_status text, p_date date) TO authenticated;


--
-- Name: FUNCTION admin_get_external_access_application(application_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_external_access_application(application_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_external_access_application(application_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_get_external_access_application(application_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_get_external_access_applications(status_param text, search_param text, limit_param integer, offset_param integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_external_access_applications(status_param text, search_param text, limit_param integer, offset_param integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_external_access_applications(status_param text, search_param text, limit_param integer, offset_param integer) TO service_role;
GRANT ALL ON FUNCTION public.admin_get_external_access_applications(status_param text, search_param text, limit_param integer, offset_param integer) TO authenticated;


--
-- Name: FUNCTION admin_get_external_registration_notification_recipients(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_external_registration_notification_recipients() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_external_registration_notification_recipients() TO service_role;
GRANT ALL ON FUNCTION public.admin_get_external_registration_notification_recipients() TO authenticated;


--
-- Name: FUNCTION admin_get_external_registration_result_email_batch(application_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_external_registration_result_email_batch(application_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_external_registration_result_email_batch(application_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_get_external_registration_result_email_batch(application_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_get_external_registration_vendors(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_external_registration_vendors() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_external_registration_vendors() TO service_role;
GRANT ALL ON FUNCTION public.admin_get_external_registration_vendors() TO authenticated;


--
-- Name: FUNCTION admin_get_question_revisions(question_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_question_revisions(question_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_question_revisions(question_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_get_question_revisions(question_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_get_supplier_outsource_launch_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_supplier_outsource_launch_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_supplier_outsource_launch_status() TO service_role;
GRANT ALL ON FUNCTION public.admin_get_supplier_outsource_launch_status() TO authenticated;


--
-- Name: FUNCTION admin_get_vendor_duplicate_groups(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_vendor_duplicate_groups() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_vendor_duplicate_groups() TO service_role;
GRANT ALL ON FUNCTION public.admin_get_vendor_duplicate_groups() TO authenticated;


--
-- Name: FUNCTION admin_list_users(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_users() TO service_role;
GRANT ALL ON FUNCTION public.admin_list_users() TO authenticated;


--
-- Name: FUNCTION admin_record_external_registration_email_result(outbox_id_param uuid, sent_param boolean, error_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_record_external_registration_email_result(outbox_id_param uuid, sent_param boolean, error_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_record_external_registration_email_result(outbox_id_param uuid, sent_param boolean, error_param text) TO service_role;
GRANT ALL ON FUNCTION public.admin_record_external_registration_email_result(outbox_id_param uuid, sent_param boolean, error_param text) TO authenticated;


--
-- Name: FUNCTION admin_remove_external_registration_notification_recipient(recipient_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_remove_external_registration_notification_recipient(recipient_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_remove_external_registration_notification_recipient(recipient_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_remove_external_registration_notification_recipient(recipient_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_reset_induction(user_ids_param uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reset_induction(user_ids_param uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reset_induction(user_ids_param uuid[]) TO service_role;
GRANT ALL ON FUNCTION public.admin_reset_induction(user_ids_param uuid[]) TO authenticated;


--
-- Name: FUNCTION admin_resolve_external_access_application(application_id_param uuid, action_param text, vendor_id_param uuid, new_company_status_param text, admin_note_param text, rejection_reason_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_resolve_external_access_application(application_id_param uuid, action_param text, vendor_id_param uuid, new_company_status_param text, admin_note_param text, rejection_reason_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_resolve_external_access_application(application_id_param uuid, action_param text, vendor_id_param uuid, new_company_status_param text, admin_note_param text, rejection_reason_param text) TO service_role;
GRANT ALL ON FUNCTION public.admin_resolve_external_access_application(application_id_param uuid, action_param text, vendor_id_param uuid, new_company_status_param text, admin_note_param text, rejection_reason_param text) TO authenticated;


--
-- Name: FUNCTION admin_restore_question_revision(question_id_param uuid, revision_id_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_restore_question_revision(question_id_param uuid, revision_id_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_restore_question_revision(question_id_param uuid, revision_id_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.admin_restore_question_revision(question_id_param uuid, revision_id_param uuid) TO authenticated;


--
-- Name: FUNCTION admin_save_external_registration_notification_recipient(recipient_id_param uuid, display_name_param text, email_param text, is_active_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_external_registration_notification_recipient(recipient_id_param uuid, display_name_param text, email_param text, is_active_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_external_registration_notification_recipient(recipient_id_param uuid, display_name_param text, email_param text, is_active_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_save_external_registration_notification_recipient(recipient_id_param uuid, display_name_param text, email_param text, is_active_param boolean) TO authenticated;


--
-- Name: FUNCTION admin_save_question(question_id_param uuid, exam_type_param text, pattern_param text, content_th_param text, content_en_param text, choices_json_param jsonb, correct_choice_index_param integer, image_url_param text, is_active_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_question(question_id_param uuid, exam_type_param text, pattern_param text, content_th_param text, content_en_param text, choices_json_param jsonb, correct_choice_index_param integer, image_url_param text, is_active_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_question(question_id_param uuid, exam_type_param text, pattern_param text, content_th_param text, content_en_param text, choices_json_param jsonb, correct_choice_index_param integer, image_url_param text, is_active_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_save_question(question_id_param uuid, exam_type_param text, pattern_param text, content_th_param text, content_en_param text, choices_json_param jsonb, correct_choice_index_param integer, image_url_param text, is_active_param boolean) TO authenticated;


--
-- Name: FUNCTION admin_save_vendor(vendor_id_param uuid, name_param text, status_param text, allow_similar_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_save_vendor(vendor_id_param uuid, name_param text, status_param text, allow_similar_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_save_vendor(vendor_id_param uuid, name_param text, status_param text, allow_similar_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_save_vendor(vendor_id_param uuid, name_param text, status_param text, allow_similar_param boolean) TO authenticated;


--
-- Name: FUNCTION admin_set_external_registration_feature(enabled_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_external_registration_feature(enabled_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_external_registration_feature(enabled_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_external_registration_feature(enabled_param boolean) TO authenticated;


--
-- Name: FUNCTION admin_set_supplier_outsource_access(user_id_param uuid, enabled_param boolean, participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_supplier_outsource_access(user_id_param uuid, enabled_param boolean, participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_supplier_outsource_access(user_id_param uuid, enabled_param boolean, participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_supplier_outsource_access(user_id_param uuid, enabled_param boolean, participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO authenticated;


--
-- Name: FUNCTION admin_set_supplier_outsource_access_bulk(user_ids_param uuid[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_supplier_outsource_access_bulk(user_ids_param uuid[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_supplier_outsource_access_bulk(user_ids_param uuid[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_supplier_outsource_access_bulk(user_ids_param uuid[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO authenticated;


--
-- Name: FUNCTION admin_set_supplier_outsource_feature(enabled_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_supplier_outsource_feature(enabled_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_supplier_outsource_feature(enabled_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_supplier_outsource_feature(enabled_param boolean) TO authenticated;


--
-- Name: FUNCTION admin_set_training_access(user_id_param uuid, program_code_param text, enabled_param boolean, participant_type_param text, work_type_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_training_access(user_id_param uuid, program_code_param text, enabled_param boolean, participant_type_param text, work_type_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_training_access(user_id_param uuid, program_code_param text, enabled_param boolean, participant_type_param text, work_type_param text) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_training_access(user_id_param uuid, program_code_param text, enabled_param boolean, participant_type_param text, work_type_param text) TO authenticated;


--
-- Name: FUNCTION admin_set_user_active(user_id_param uuid, is_active_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_user_active(user_id_param uuid, is_active_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_user_active(user_id_param uuid, is_active_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.admin_set_user_active(user_id_param uuid, is_active_param boolean) TO authenticated;


--
-- Name: FUNCTION admin_supplier_outsource_report(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_supplier_outsource_report() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_supplier_outsource_report() TO service_role;
GRANT ALL ON FUNCTION public.admin_supplier_outsource_report() TO authenticated;


--
-- Name: FUNCTION admin_update_system_setting(key_param text, value_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_system_setting(key_param text, value_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_system_setting(key_param text, value_param text) TO service_role;
GRANT ALL ON FUNCTION public.admin_update_system_setting(key_param text, value_param text) TO authenticated;


--
-- Name: FUNCTION admin_update_user_profile(user_id_param uuid, name_param text, age_param integer, nationality_param text, vendor_id_param uuid, induction_expiry_param timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_user_profile(user_id_param uuid, name_param text, age_param integer, nationality_param text, vendor_id_param uuid, induction_expiry_param timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_user_profile(user_id_param uuid, name_param text, age_param integer, nationality_param text, vendor_id_param uuid, induction_expiry_param timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.admin_update_user_profile(user_id_param uuid, name_param text, age_param integer, nationality_param text, vendor_id_param uuid, induction_expiry_param timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION admin_upsert_staged_user(national_id_param text, name_param text, vendor_id_param uuid, role_param text, age_param integer, nationality_param text, induction_expiry_param timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_upsert_staged_user(national_id_param text, name_param text, vendor_id_param uuid, role_param text, age_param integer, nationality_param text, induction_expiry_param timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_upsert_staged_user(national_id_param text, name_param text, vendor_id_param uuid, role_param text, age_param integer, nationality_param text, induction_expiry_param timestamp with time zone) TO service_role;
GRANT ALL ON FUNCTION public.admin_upsert_staged_user(national_id_param text, name_param text, vendor_id_param uuid, role_param text, age_param integer, nationality_param text, induction_expiry_param timestamp with time zone) TO authenticated;


--
-- Name: FUNCTION audit_admin_directory_mutation(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_admin_directory_mutation() FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_admin_directory_mutation() TO service_role;


--
-- Name: FUNCTION capture_question_revision(question_id_param uuid, change_type_param text, note_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.capture_question_revision(question_id_param uuid, change_type_param text, note_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.capture_question_revision(question_id_param uuid, change_type_param text, note_param text) TO service_role;


--
-- Name: FUNCTION check_user_exists(search_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.check_user_exists(search_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.check_user_exists(search_id text) TO service_role;


--
-- Name: FUNCTION complete_registration(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_registration(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_registration(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text) TO service_role;


--
-- Name: FUNCTION complete_registration_v2(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_registration_v2(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_registration_v2(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO service_role;


--
-- Name: FUNCTION complete_registration_v3(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_registration_v3(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_registration_v3(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO service_role;


--
-- Name: FUNCTION complete_registration_v4(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_registration_v4(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_registration_v4(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO service_role;
GRANT ALL ON FUNCTION public.complete_registration_v4(national_id_param text, name_param text, vendor_id_param uuid, age_param integer, nationality_param text, other_vendor_name_param text, program_codes_param text[], participant_type_param text, work_type_param text, access_start_date_param date, access_end_date_param date) TO authenticated;


--
-- Name: FUNCTION create_external_access_application(company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[], pdpa_agreed_param boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.create_external_access_application(company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[], pdpa_agreed_param boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_external_access_application(company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[], pdpa_agreed_param boolean) TO service_role;
GRANT ALL ON FUNCTION public.create_external_access_application(company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[], pdpa_agreed_param boolean) TO anon;
GRANT ALL ON FUNCTION public.create_external_access_application(company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[], pdpa_agreed_param boolean) TO authenticated;


--
-- Name: FUNCTION encrypt_user_data(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.encrypt_user_data() FROM PUBLIC;
GRANT ALL ON FUNCTION public.encrypt_user_data() TO service_role;


--
-- Name: FUNCTION external_registration_queue_followup_email(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.external_registration_queue_followup_email() FROM PUBLIC;
GRANT ALL ON FUNCTION public.external_registration_queue_followup_email() TO service_role;


--
-- Name: FUNCTION external_registration_set_updated_at(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.external_registration_set_updated_at() FROM PUBLIC;
GRANT ALL ON FUNCTION public.external_registration_set_updated_at() TO service_role;


--
-- Name: FUNCTION find_vendor_name_matches(search_name_param text, exclude_vendor_id_param uuid, limit_param integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.find_vendor_name_matches(search_name_param text, exclude_vendor_id_param uuid, limit_param integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.find_vendor_name_matches(search_name_param text, exclude_vendor_id_param uuid, limit_param integer) TO service_role;
GRANT ALL ON FUNCTION public.find_vendor_name_matches(search_name_param text, exclude_vendor_id_param uuid, limit_param integer) TO anon;
GRANT ALL ON FUNCTION public.find_vendor_name_matches(search_name_param text, exclude_vendor_id_param uuid, limit_param integer) TO authenticated;


--
-- Name: FUNCTION get_auth_login_context(national_id_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_auth_login_context(national_id_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_auth_login_context(national_id_param text) TO service_role;


--
-- Name: FUNCTION get_exam_questions(exam_type_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_exam_questions(exam_type_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_exam_questions(exam_type_param text) TO authenticated;
GRANT ALL ON FUNCTION public.get_exam_questions(exam_type_param text) TO service_role;


--
-- Name: FUNCTION get_external_access_application_edit_form(request_no_param text, tracking_token_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_external_access_application_edit_form(request_no_param text, tracking_token_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_external_access_application_edit_form(request_no_param text, tracking_token_param text) TO service_role;
GRANT ALL ON FUNCTION public.get_external_access_application_edit_form(request_no_param text, tracking_token_param text) TO anon;
GRANT ALL ON FUNCTION public.get_external_access_application_edit_form(request_no_param text, tracking_token_param text) TO authenticated;


--
-- Name: FUNCTION get_external_access_application_status(request_no_param text, tracking_token_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_external_access_application_status(request_no_param text, tracking_token_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_external_access_application_status(request_no_param text, tracking_token_param text) TO service_role;
GRANT ALL ON FUNCTION public.get_external_access_application_status(request_no_param text, tracking_token_param text) TO anon;
GRANT ALL ON FUNCTION public.get_external_access_application_status(request_no_param text, tracking_token_param text) TO authenticated;


--
-- Name: FUNCTION get_external_registration_email_batch(request_no_param text, tracking_token_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_external_registration_email_batch(request_no_param text, tracking_token_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_external_registration_email_batch(request_no_param text, tracking_token_param text) TO service_role;


--
-- Name: FUNCTION get_external_registration_feature_flag(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_external_registration_feature_flag() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_external_registration_feature_flag() TO service_role;
GRANT ALL ON FUNCTION public.get_external_registration_feature_flag() TO anon;
GRANT ALL ON FUNCTION public.get_external_registration_feature_flag() TO authenticated;


--
-- Name: FUNCTION get_my_admin_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_admin_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_admin_status() TO service_role;
GRANT ALL ON FUNCTION public.get_my_admin_status() TO authenticated;


--
-- Name: FUNCTION get_my_decrypted_id(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_decrypted_id() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_decrypted_id() TO service_role;
GRANT ALL ON FUNCTION public.get_my_decrypted_id() TO authenticated;


--
-- Name: FUNCTION get_my_staged_registration_profile(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_staged_registration_profile() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_staged_registration_profile() TO service_role;
GRANT ALL ON FUNCTION public.get_my_staged_registration_profile() TO authenticated;


--
-- Name: FUNCTION get_my_supplier_outsource_access_notification(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_supplier_outsource_access_notification() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_supplier_outsource_access_notification() TO service_role;
GRANT ALL ON FUNCTION public.get_my_supplier_outsource_access_notification() TO authenticated;


--
-- Name: FUNCTION get_my_supplier_outsource_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_my_supplier_outsource_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_my_supplier_outsource_status() TO service_role;
GRANT ALL ON FUNCTION public.get_my_supplier_outsource_status() TO authenticated;


--
-- Name: FUNCTION get_public_feature_flags(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_feature_flags() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_feature_flags() TO service_role;
GRANT ALL ON FUNCTION public.get_public_feature_flags() TO anon;
GRANT ALL ON FUNCTION public.get_public_feature_flags() TO authenticated;


--
-- Name: FUNCTION get_public_registration_vendors(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_registration_vendors() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_registration_vendors() TO service_role;
GRANT ALL ON FUNCTION public.get_public_registration_vendors() TO anon;
GRANT ALL ON FUNCTION public.get_public_registration_vendors() TO authenticated;


--
-- Name: FUNCTION get_public_support_links(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_support_links() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_support_links() TO service_role;
GRANT ALL ON FUNCTION public.get_public_support_links() TO anon;
GRANT ALL ON FUNCTION public.get_public_support_links() TO authenticated;


--
-- Name: FUNCTION get_runtime_system_settings(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_runtime_system_settings() FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_runtime_system_settings() TO service_role;
GRANT ALL ON FUNCTION public.get_runtime_system_settings() TO authenticated;


--
-- Name: FUNCTION guard_vendor_name_duplicates(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.guard_vendor_name_duplicates() FROM PUBLIC;
GRANT ALL ON FUNCTION public.guard_vendor_name_duplicates() TO service_role;


--
-- Name: FUNCTION initialize_user_auth_security(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.initialize_user_auth_security() FROM PUBLIC;
GRANT ALL ON FUNCTION public.initialize_user_auth_security() TO service_role;


--
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;


--
-- Name: FUNCTION link_my_line_identity(line_user_id_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.link_my_line_identity(line_user_id_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.link_my_line_identity(line_user_id_param text) TO service_role;
GRANT ALL ON FUNCTION public.link_my_line_identity(line_user_id_param text) TO authenticated;


--
-- Name: FUNCTION normalize_vendor_name(input_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.normalize_vendor_name(input_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.normalize_vendor_name(input_name text) TO service_role;
GRANT ALL ON FUNCTION public.normalize_vendor_name(input_name text) TO authenticated;


--
-- Name: FUNCTION protect_user_security_fields(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.protect_user_security_fields() FROM PUBLIC;
GRANT ALL ON FUNCTION public.protect_user_security_fields() TO service_role;


--
-- Name: FUNCTION record_auth_login_failure(national_id_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_auth_login_failure(national_id_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_auth_login_failure(national_id_param text) TO service_role;


--
-- Name: FUNCTION record_auth_login_success(national_id_param text, pin_version_param integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_auth_login_success(national_id_param text, pin_version_param integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_auth_login_success(national_id_param text, pin_version_param integer) TO service_role;


--
-- Name: FUNCTION record_external_registration_email_result(outbox_id_param uuid, tracking_token_param text, sent_param boolean, error_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_external_registration_email_result(outbox_id_param uuid, tracking_token_param text, sent_param boolean, error_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_external_registration_email_result(outbox_id_param uuid, tracking_token_param text, sent_param boolean, error_param text) TO service_role;


--
-- Name: FUNCTION repair_my_orphaned_registration(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.repair_my_orphaned_registration() FROM PUBLIC;
GRANT ALL ON FUNCTION public.repair_my_orphaned_registration() TO service_role;
GRANT ALL ON FUNCTION public.repair_my_orphaned_registration() TO authenticated;


--
-- Name: FUNCTION reset_my_induction(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.reset_my_induction() FROM PUBLIC;
GRANT ALL ON FUNCTION public.reset_my_induction() TO service_role;
GRANT ALL ON FUNCTION public.reset_my_induction() TO authenticated;


--
-- Name: FUNCTION resubmit_external_access_application(request_no_param text, tracking_token_param text, company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.resubmit_external_access_application(request_no_param text, tracking_token_param text, company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.resubmit_external_access_application(request_no_param text, tracking_token_param text, company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[]) TO service_role;
GRANT ALL ON FUNCTION public.resubmit_external_access_application(request_no_param text, tracking_token_param text, company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[]) TO anon;
GRANT ALL ON FUNCTION public.resubmit_external_access_application(request_no_param text, tracking_token_param text, company_name_param text, requested_types_param text[], first_name_th_param text, last_name_th_param text, first_name_en_param text, last_name_en_param text, job_title_param text, login_email_param text, phone_param text, coordinator_names_param text[]) TO authenticated;


--
-- Name: FUNCTION submit_safety_exam(exam_type_param text, answers_param jsonb, permit_no_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.submit_safety_exam(exam_type_param text, answers_param jsonb, permit_no_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.submit_safety_exam(exam_type_param text, answers_param jsonb, permit_no_param text) TO authenticated;
GRANT ALL ON FUNCTION public.submit_safety_exam(exam_type_param text, answers_param jsonb, permit_no_param text) TO service_role;


--
-- Name: FUNCTION verify_induction_pass(national_id_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_induction_pass(national_id_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_induction_pass(national_id_param text) TO anon;
GRANT ALL ON FUNCTION public.verify_induction_pass(national_id_param text) TO authenticated;
GRANT ALL ON FUNCTION public.verify_induction_pass(national_id_param text) TO service_role;


--
-- Name: FUNCTION verify_safety_pass(permit_no_param text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_safety_pass(permit_no_param text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_safety_pass(permit_no_param text) TO anon;
GRANT ALL ON FUNCTION public.verify_safety_pass(permit_no_param text) TO authenticated;
GRANT ALL ON FUNCTION public.verify_safety_pass(permit_no_param text) TO service_role;


--
-- Name: FUNCTION verify_supplier_outsource_pass(token_param uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.verify_supplier_outsource_pass(token_param uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.verify_supplier_outsource_pass(token_param uuid) TO service_role;
GRANT ALL ON FUNCTION public.verify_supplier_outsource_pass(token_param uuid) TO anon;
GRANT ALL ON FUNCTION public.verify_supplier_outsource_pass(token_param uuid) TO authenticated;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.audit_logs TO authenticated;
GRANT ALL ON TABLE public.audit_logs TO service_role;


--
-- Name: TABLE exam_history; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.exam_history TO authenticated;
GRANT ALL ON TABLE public.exam_history TO service_role;


--
-- Name: TABLE exam_logs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.exam_logs TO authenticated;
GRANT ALL ON TABLE public.exam_logs TO service_role;


--
-- Name: SEQUENCE external_access_request_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.external_access_request_seq TO anon;
GRANT ALL ON SEQUENCE public.external_access_request_seq TO authenticated;
GRANT ALL ON SEQUENCE public.external_access_request_seq TO service_role;


--
-- Name: TABLE external_access_applications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_access_applications TO service_role;


--
-- Name: TABLE external_application_contacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_application_contacts TO service_role;


--
-- Name: TABLE external_application_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_application_status_history TO service_role;


--
-- Name: TABLE external_application_types; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_application_types TO service_role;


--
-- Name: TABLE external_registration_email_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_registration_email_outbox TO service_role;


--
-- Name: TABLE external_registration_notification_recipients; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.external_registration_notification_recipients TO service_role;


--
-- Name: TABLE question_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.question_revisions TO service_role;


--
-- Name: TABLE questions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.questions TO authenticated;
GRANT ALL ON TABLE public.questions TO service_role;


--
-- Name: TABLE supplier_outsource_passes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.supplier_outsource_passes TO service_role;
GRANT SELECT ON TABLE public.supplier_outsource_passes TO authenticated;


--
-- Name: TABLE system_config; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.system_config TO authenticated;
GRANT ALL ON TABLE public.system_config TO service_role;


--
-- Name: TABLE user_auth_security; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_auth_security TO service_role;


--
-- Name: TABLE user_training_access; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_training_access TO service_role;
GRANT SELECT ON TABLE public.user_training_access TO authenticated;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE vendors; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.vendors TO authenticated;
GRANT ALL ON TABLE public.vendors TO service_role;


--
-- Name: TABLE work_permits; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,MAINTAIN ON TABLE public.work_permits TO authenticated;
GRANT ALL ON TABLE public.work_permits TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--
