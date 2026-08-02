begin;

update public.system_config
set value = 'true'
where key = 'EXTERNAL_REGISTRATION_ENABLED';

insert into public.external_registration_notification_recipients(
  display_name, email, purpose, is_active
)
values (
  'Sattaya Admin', 'sattaya_w@thaisummit-harness.co.th',
  'EXTERNAL_REGISTRATION_ADMIN', true
)
on conflict (lower(email), purpose) do update
set is_active = true;

do $$
declare
  submission jsonb;
  request_no_value text;
  tracking_token_value text;
  application_id_value uuid;
  status_value text;
  type_count integer;
  contact_count integer;
  outbox_count integer;
  tracking_result jsonb;
begin
  submission := public.create_external_access_application(
    'Phase Three New Company Co., Ltd.',
    array['CONTRACTOR', 'SUPPLIER', 'OUTSOURCE']::text[],
    'ผู้สมัคร',
    'ทดสอบระบบ',
    'Test',
    'Applicant',
    'Safety Coordinator',
    'tawun666956666956@gmail.com',
    '0812345678',
    array['คุณประสานงาน หนึ่ง', 'คุณประสานงาน สอง']::text[],
    true
  );

  request_no_value := submission ->> 'request_no';
  tracking_token_value := submission ->> 'tracking_token';

  if request_no_value is null or tracking_token_value is null then
    raise exception 'Submission did not return request tracking details: %', submission;
  end if;

  select id, status into application_id_value, status_value
  from public.external_access_applications
  where request_no = request_no_value;

  if application_id_value is null or status_value is distinct from 'SUBMITTED' then
    raise exception 'Submission did not create a SUBMITTED application';
  end if;

  select count(*) into type_count
  from public.external_application_types
  where application_id = application_id_value;

  select count(*) into contact_count
  from public.external_application_contacts
  where application_id = application_id_value;

  select count(*) into outbox_count
  from public.external_registration_email_outbox
  where application_id = application_id_value;

  if type_count <> 3 or contact_count <> 2 or outbox_count < 1 then
    raise exception 'Submission child rows are incomplete: types %, contacts %, outbox %',
      type_count, contact_count, outbox_count;
  end if;

  if not exists (
    select 1
    from public.external_registration_email_outbox
    where application_id = application_id_value
      and template_key = 'external_registration_applicant_received'
      and payload ->> 'trackingToken' = tracking_token_value
  ) then
    raise exception 'Applicant email outbox did not retain the tracking token';
  end if;

  tracking_result := public.get_external_access_application_status(
    request_no_value,
    tracking_token_value
  );

  if tracking_result ->> 'status' is distinct from 'SUBMITTED'
     or jsonb_array_length(tracking_result -> 'types') <> 3
     or jsonb_array_length(tracking_result -> 'coordinators') <> 2 then
    raise exception 'Tracking status returned unexpected data: %', tracking_result;
  end if;
end;
$$;

do $$
begin
  begin
    perform public.create_external_access_application(
      'Invalid PDPA Company', array['CONTRACTOR']::text[],
      'Test', 'Applicant', 'Test', 'Applicant', 'Role',
      'invalid-pdpa@example.com', '0812345678', array['TSH Contact']::text[], false
    );
    raise exception 'PDPA validation unexpectedly allowed submission';
  exception
    when raise_exception then
      if sqlerrm = 'PDPA validation unexpectedly allowed submission' then raise; end if;
  end;
end;
$$;

rollback;
