begin;

insert into public.users(id, national_id, name, role, pdpa_agreed, is_active)
values ('99999999-9999-4999-8999-999999999902', '9999999999902', 'Phase Four Follow-up Admin', 'ADMIN', true, true);

update public.system_config
set value = 'true'
where key = 'EXTERNAL_REGISTRATION_ENABLED';

insert into public.external_registration_notification_recipients(
  display_name, email, purpose, is_active
)
values (
  'Follow-up Admin', 'sattaya_w@thaisummit-harness.co.th',
  'EXTERNAL_REGISTRATION_ADMIN', true
)
on conflict (lower(email), purpose) do update
set is_active = true;

set local role authenticated;
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999902', true);
select set_config('request.jwt.claims', '{"sub":"99999999-9999-4999-8999-999999999902","role":"authenticated"}', true);

do $$
declare
  submission jsonb;
  application_id_value uuid;
  edit_value jsonb;
  detail_value jsonb;
  status_value jsonb;
  result_batch_count integer;
begin
  submission := public.create_external_access_application(
    'Phase Follow-up Company Co., Ltd.',
    array['SUPPLIER']::text[],
    'Follow', 'Up', 'Follow', 'Up', 'Coordinator',
    'tawun666956666956@gmail.com', '0800000000', array['TSH Follow-up Owner']::text[], true
  );
  perform set_config('safetypass_test.request_no', submission ->> 'request_no', true);
  perform set_config('safetypass_test.tracking_token', submission ->> 'tracking_token', true);

  select id into application_id_value
  from public.admin_get_external_access_applications(null, submission ->> 'request_no', 10, 0)
  limit 1;

  if application_id_value is null then raise exception 'Follow-up test application was not created'; end if;

  perform public.admin_resolve_external_access_application(
    application_id_value, 'NEED_MORE_INFO', null, 'PENDING',
    'กรุณาแนบข้อมูลผู้ประสานงานเพิ่มเติม', null
  );

  select count(*) into result_batch_count
  from public.admin_get_external_registration_result_email_batch(application_id_value)
  where payload ->> 'status' = 'NEED_MORE_INFO'
    and payload ->> 'trackingToken' = submission ->> 'tracking_token';
  if result_batch_count <> 1 then
    raise exception 'NEED_MORE_INFO email was not queued with tracking token';
  end if;

  edit_value := public.get_external_access_application_edit_form(
    submission ->> 'request_no', submission ->> 'tracking_token'
  );
  if edit_value ->> 'status' <> 'NEED_MORE_INFO'
     or edit_value ->> 'admin_note' <> 'กรุณาแนบข้อมูลผู้ประสานงานเพิ่มเติม' then
    raise exception 'Applicant edit form did not return the previous request data: %', edit_value;
  end if;

  status_value := public.resubmit_external_access_application(
    submission ->> 'request_no', submission ->> 'tracking_token',
    'Phase Follow-up Company Updated Co., Ltd.',
    array['SUPPLIER', 'OUTSOURCE']::text[],
    'Follow', 'Up', 'Follow', 'Up', 'Updated Coordinator',
    'tawun666956666956@gmail.com', '0811111111',
    array['TSH Follow-up Owner', 'TSH Second Owner']::text[]
  );
  if status_value ->> 'status' <> 'SUBMITTED' then
    raise exception 'Resubmission did not return SUBMITTED: %', status_value;
  end if;

  detail_value := public.admin_get_external_access_application(application_id_value);
  if detail_value -> 'application' ->> 'status' <> 'SUBMITTED'
     or detail_value -> 'application' ->> 'company_name_submitted' <> 'Phase Follow-up Company Updated Co., Ltd.'
     or detail_value -> 'application' ->> 'phone' <> '0811111111' then
    raise exception 'Resubmission did not update the original application: %', detail_value;
  end if;

  status_value := public.admin_delete_external_access_application(
    application_id_value, 'ลบคำขอหลังจบ regression test'
  );
  if status_value ->> 'status' <> 'CANCELLED' then
    raise exception 'Admin delete did not soft-delete the request: %', status_value;
  end if;

  if exists (
    select 1 from public.admin_get_external_access_applications(null, submission ->> 'request_no', 10, 0)
    where id = application_id_value
  ) then
    raise exception 'Soft-deleted request remained in the normal Admin queue';
  end if;
end;
$$;

reset role;
set local role service_role;
do $$
declare
  request_no_value text := current_setting('safetypass_test.request_no');
  tracking_token_value text := current_setting('safetypass_test.tracking_token');
  pending_received_count integer;
  pending_admin_count integer;
begin
  select count(*) into pending_received_count
  from public.get_external_registration_email_batch(request_no_value, tracking_token_value)
  where template_key = 'external_registration_applicant_received'
    and payload ->> 'trackingToken' = tracking_token_value;
  if pending_received_count < 1 then
    raise exception 'Resubmission did not queue applicant confirmation email';
  end if;

  select count(*) into pending_admin_count
  from public.get_external_registration_email_batch(request_no_value, tracking_token_value)
  where template_key = 'external_registration_admin_notice';
  if pending_admin_count < 2 then
    raise exception 'Resubmission did not queue a new Admin notification email';
  end if;
end;
$$;
reset role;
rollback;
