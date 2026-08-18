begin;

insert into public.users(id, national_id, name, role, pdpa_agreed, is_active)
values (
  'a1819000-0000-4000-8000-000000000001',
  '1999999999801',
  'External Status Audit Admin',
  'ADMIN', true, true
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'a1819000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', '1999999999801@safetypass.com',
  'test-password-hash', now(),
  '{"provider":"email","providers":["email"]}',
  '{"password_scheme":"pin-v2"}', now(), now()
);

update public.system_config
set value = 'true'
where key = 'EXTERNAL_REGISTRATION_ENABLED';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1819000-0000-4000-8000-000000000001', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"a1819000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

do $$
declare
  review_submission jsonb;
  approval_submission jsonb;
  delete_submission jsonb;
  review_id uuid;
  approval_id uuid;
  delete_id uuid;
  result_value jsonb;
  detail_value jsonb;
  queued_count integer;
begin
  review_submission := public.create_external_access_application(
    'External Status Review Fixture', array['SUPPLIER']::text[],
    'Status', 'Review', 'Status', 'Review', 'Coordinator',
    'external-status-review@example.com', '0800000101', array['Owner One']::text[], true
  );
  select id into review_id
  from public.admin_get_external_access_applications(
    null, review_submission ->> 'request_no', 10, 0
  ) limit 1;

  result_value := public.admin_resolve_external_access_application(
    review_id, 'UNDER_REVIEW', null, 'PENDING', 'Review started', null
  );
  if result_value ->> 'status' <> 'UNDER_REVIEW' then
    raise exception 'UNDER_REVIEW action failed: %', result_value;
  end if;

  result_value := public.admin_resolve_external_access_application(
    review_id, 'NEED_MORE_INFO', null, 'PENDING', 'Please provide more information', null
  );
  if result_value ->> 'status' <> 'NEED_MORE_INFO' then
    raise exception 'NEED_MORE_INFO action failed: %', result_value;
  end if;

  result_value := public.admin_resolve_external_access_application(
    review_id, 'REJECTED', null, 'PENDING', 'Review completed', 'Fixture rejection reason'
  );
  if result_value ->> 'status' <> 'REJECTED' then
    raise exception 'REJECTED action failed: %', result_value;
  end if;

  approval_submission := public.create_external_access_application(
    'External Status Approval Fixture', array['CONTRACTOR']::text[],
    'Status', 'Approve', 'Status', 'Approve', 'Coordinator',
    'external-status-approve@example.com', '0800000102', array['Owner Two']::text[], true
  );
  select id into approval_id
  from public.admin_get_external_access_applications(
    null, approval_submission ->> 'request_no', 10, 0
  ) limit 1;
  result_value := public.admin_resolve_external_access_application(
    approval_id, 'APPROVED', null, 'PENDING', 'Fixture approved', null
  );
  if result_value ->> 'status' <> 'APPROVED' then
    raise exception 'APPROVED action failed: %', result_value;
  end if;

  delete_submission := public.create_external_access_application(
    'External Status Delete Fixture', array['OUTSOURCE']::text[],
    'Status', 'Delete', 'Status', 'Delete', 'Coordinator',
    'external-status-delete@example.com', '0800000103', array['Owner Three']::text[], true
  );
  select id into delete_id
  from public.admin_get_external_access_applications(
    null, delete_submission ->> 'request_no', 10, 0
  ) limit 1;
  result_value := public.admin_delete_external_access_application(
    delete_id, 'Fixture soft delete'
  );
  if result_value ->> 'status' <> 'CANCELLED' then
    raise exception 'DELETE action failed: %', result_value;
  end if;

  detail_value := public.admin_get_external_access_application(review_id);
  if jsonb_array_length(detail_value -> 'history') <> 4 then
    raise exception 'Status history did not preserve all review transitions';
  end if;

  select count(*) into queued_count
  from public.admin_get_external_registration_result_email_batch(review_id);
  if queued_count <> 3 then
    raise exception 'Status result emails were not queued for all review transitions';
  end if;

  select count(*) into queued_count
  from public.admin_get_external_registration_result_email_batch(approval_id);
  if queued_count <> 1 then
    raise exception 'Approval result email was not queued';
  end if;
end;
$$;

reset role;

do $$
declare
  expected_actions text[] := array[
    'EXTERNAL_REGISTRATION_APPLICATION_UNDER_REVIEW',
    'EXTERNAL_REGISTRATION_APPLICATION_NEED_MORE_INFO',
    'EXTERNAL_REGISTRATION_APPLICATION_REJECTED',
    'EXTERNAL_REGISTRATION_APPLICATION_APPROVED',
    'EXTERNAL_REGISTRATION_APPLICATION_DELETED'
  ];
  action_value text;
begin
  foreach action_value in array expected_actions loop
    if not exists (
      select 1 from public.audit_logs
      where action = action_value
        and actor_user_id = 'a1819000-0000-4000-8000-000000000001'
        and admin_email !~ '^[0-9]{13}@'
    ) then
      raise exception 'Safe audit row was not written for %', action_value;
    end if;
  end loop;

  if exists (
    select 1 from public.audit_logs
    where admin_email ~ '^[0-9]{13}@'
       or details ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)'
  ) then raise exception 'Full national ID leaked into audit logs'; end if;
end;
$$;
rollback;
