begin;

-- Keep the applicant's one-time tracking token in the protected applicant email
-- outbox payload so later approval/rejection emails can reuse the same link.
-- The public status RPC still exposes status only after the token is supplied.

create or replace function public.create_external_access_application(
  company_name_param text,
  requested_types_param text[],
  first_name_th_param text,
  last_name_th_param text,
  first_name_en_param text,
  last_name_en_param text,
  job_title_param text,
  login_email_param text,
  phone_param text,
  coordinator_names_param text[],
  pdpa_agreed_param boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.create_external_access_application(text, text[], text, text, text, text, text, text, text, text[], boolean) from public;
grant execute on function public.create_external_access_application(text, text[], text, text, text, text, text, text, text, text[], boolean) to anon, authenticated, service_role;

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

revoke all on function public.admin_get_external_registration_result_email_batch(uuid) from public, anon;
grant execute on function public.admin_get_external_registration_result_email_batch(uuid) to authenticated, service_role;

commit;
