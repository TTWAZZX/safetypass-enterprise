begin;

-- Phase 4 admin review workflow. All external-registration data is exposed
-- through admin-only RPCs; existing tables and workflows remain untouched.

create or replace function public.admin_get_external_access_applications(
  status_param text default null,
  search_param text default null,
  limit_param integer default 100,
  offset_param integer default 0
)
returns table(
  id uuid,
  request_no text,
  company_name_submitted text,
  vendor_id uuid,
  vendor_name text,
  vendor_status text,
  company_resolution text,
  first_name_th text,
  last_name_th text,
  first_name_en text,
  last_name_en text,
  job_title text,
  login_email text,
  phone text,
  status text,
  admin_note text,
  rejection_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  types jsonb,
  coordinators jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
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
  where (nullif(btrim(coalesce(status_param, '')), '') is null
         or a.status = upper(btrim(status_param)))
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

revoke all on function public.admin_get_external_access_applications(text, text, integer, integer) from public, anon;
grant execute on function public.admin_get_external_access_applications(text, text, integer, integer) to authenticated, service_role;

create or replace function public.admin_get_external_access_application(
  application_id_param uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.admin_get_external_access_application(uuid) from public, anon;
grant execute on function public.admin_get_external_access_application(uuid) to authenticated, service_role;

create or replace function public.admin_get_external_registration_vendors()
returns table(id uuid, name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select v.id, v.name, v.status
  from public.vendors v
  order by case v.status when 'APPROVED' then 1 when 'PENDING' then 2 else 3 end,
    lower(v.name), v.created_at;
end;
$$;

revoke all on function public.admin_get_external_registration_vendors() from public, anon;
grant execute on function public.admin_get_external_registration_vendors() to authenticated, service_role;

create or replace function public.admin_resolve_external_access_application(
  application_id_param uuid,
  action_param text,
  vendor_id_param uuid default null,
  new_company_status_param text default 'PENDING',
  admin_note_param text default null,
  rejection_reason_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.admin_resolve_external_access_application(uuid, text, uuid, text, text, text) from public, anon;
grant execute on function public.admin_resolve_external_access_application(uuid, text, uuid, text, text, text) to authenticated, service_role;

create or replace function public.admin_get_external_registration_result_email_batch(
  application_id_param uuid
)
returns table(
  id uuid,
  template_key text,
  recipient_email text,
  recipient_name text,
  payload jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select o.id, o.template_key, o.recipient_email, o.recipient_name, o.payload
  from public.external_registration_email_outbox o
  where o.application_id = application_id_param
    and o.template_key = 'external_registration_applicant_result'
    and o.status in ('PENDING', 'FAILED')
    and (o.next_attempt_at is null or o.next_attempt_at <= now())
  order by o.created_at, o.id;
end;
$$;

revoke all on function public.admin_get_external_registration_result_email_batch(uuid) from public, anon;
grant execute on function public.admin_get_external_registration_result_email_batch(uuid) to authenticated, service_role;

create or replace function public.admin_record_external_registration_email_result(
  outbox_id_param uuid,
  sent_param boolean,
  error_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.admin_record_external_registration_email_result(uuid, boolean, text) from public, anon;
grant execute on function public.admin_record_external_registration_email_result(uuid, boolean, text) to authenticated, service_role;

commit;
