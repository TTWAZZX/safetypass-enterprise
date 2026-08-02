begin;

-- Follow-up workflow for applicant corrections, status emails, and safe admin deletion.

create or replace function public.get_external_access_application_edit_form(
  request_no_param text,
  tracking_token_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.get_external_access_application_edit_form(text, text) from public;
grant execute on function public.get_external_access_application_edit_form(text, text) to anon, authenticated, service_role;

create or replace function public.resubmit_external_access_application(
  request_no_param text,
  tracking_token_param text,
  company_name_param text,
  requested_types_param text[],
  first_name_th_param text,
  last_name_th_param text,
  first_name_en_param text,
  last_name_en_param text,
  job_title_param text,
  login_email_param text,
  phone_param text,
  coordinator_names_param text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.resubmit_external_access_application(text, text, text, text[], text, text, text, text, text, text, text, text[]) from public;
grant execute on function public.resubmit_external_access_application(text, text, text, text[], text, text, text, text, text, text, text, text[]) to anon, authenticated, service_role;

create or replace function public.admin_delete_external_access_application(
  application_id_param uuid,
  delete_reason_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.admin_delete_external_access_application(uuid, text) from public, anon;
grant execute on function public.admin_delete_external_access_application(uuid, text) to authenticated, service_role;

-- Keep deleted requests out of the normal Admin queue while retaining them for audit/history.
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

revoke all on function public.admin_get_external_access_applications(text, text, integer, integer) from public, anon;
grant execute on function public.admin_get_external_access_applications(text, text, integer, integer) to authenticated, service_role;

-- Queue applicant emails for non-final status updates. Final statuses are queued
-- by the existing admin resolution function.
create or replace function public.external_registration_queue_followup_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

revoke all on function public.external_registration_queue_followup_email() from public, anon, authenticated;
drop trigger if exists trg_external_registration_queue_followup_email on public.external_access_applications;
create trigger trg_external_registration_queue_followup_email
after update of status on public.external_access_applications
for each row execute function public.external_registration_queue_followup_email();

commit;
