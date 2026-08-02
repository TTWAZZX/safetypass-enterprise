begin;

insert into public.users(id, national_id, name, role, pdpa_agreed, is_active)
values ('99999999-9999-4999-8999-999999999901', '9999999999901', 'Phase Four Admin', 'ADMIN', true, true);

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

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999901', true);
select set_config('request.jwt.claims', '{"sub":"99999999-9999-4999-8999-999999999901","role":"authenticated"}', true);

do $$
declare
  submission jsonb;
  application_id_value uuid;
  detail_value jsonb;
  resolve_value jsonb;
  result_email_count integer;
begin
  submission := public.create_external_access_application(
    'Phase Four Admin Workflow Company',
    array['SUPPLIER']::text[],
    'Admin', 'Workflow', 'Admin', 'Workflow', 'Manager',
    'tawun666956666956@gmail.com', '0800000000', array['TSH Owner']::text[], true
  );
  select id into application_id_value
  from public.admin_get_external_access_applications(
    null, submission ->> 'request_no', 10, 0
  )
  limit 1;
  if application_id_value is null then
    raise exception 'Admin list did not return the submitted application';
  end if;

  detail_value := public.admin_get_external_access_application(application_id_value);
  if detail_value -> 'application' ->> 'status' <> 'SUBMITTED'
     or jsonb_array_length(detail_value -> 'types') <> 1 then
    raise exception 'Admin detail returned unexpected data: %', detail_value;
  end if;

  resolve_value := public.admin_resolve_external_access_application(
    application_id_value, 'APPROVED', null, 'APPROVED', 'Approved by Phase Four test', null
  );
  if resolve_value ->> 'status' <> 'APPROVED'
     or resolve_value ->> 'company_resolution' <> 'CREATED_NEW' then
    raise exception 'Admin approval did not create and link a new company: %', resolve_value;
  end if;

  select count(*) into result_email_count
  from public.get_external_registration_email_batch(
    submission ->> 'request_no', submission ->> 'tracking_token'
  )
  where template_key = 'external_registration_applicant_result'
    and recipient_email = 'tawun666956666956@gmail.com';
  if result_email_count <> 1 then
    raise exception 'Approval result email was not queued';
  end if;

  if not exists (
    select 1
    from public.admin_get_external_registration_result_email_batch(application_id_value)
    where payload ->> 'trackingToken' = submission ->> 'tracking_token'
  ) then
    raise exception 'Approval result email batch did not expose the applicant tracking token';
  end if;

  if not exists (
    select 1
    from public.get_external_registration_email_batch(
      submission ->> 'request_no', submission ->> 'tracking_token'
    )
    where template_key = 'external_registration_admin_notice'
      and recipient_email = 'sattaya_w@thaisummit-harness.co.th'
  ) then
    raise exception 'Admin notification email was not queued';
  end if;
end;
$$;

reset role;
rollback;
