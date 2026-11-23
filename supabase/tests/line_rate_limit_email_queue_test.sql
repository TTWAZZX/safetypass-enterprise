begin;

insert into public.users (id, national_id, name, role, is_active, pdpa_agreed)
values ('da110000-0000-4000-8000-000000000001', '1888888888951', 'LINE and queue test', 'USER', true, true);

insert into public.user_training_access (user_id, program_code)
values ('da110000-0000-4000-8000-000000000001', 'CONTRACTOR');

insert into public.external_access_applications (
  id, request_no, company_name_submitted, first_name_th, last_name_th,
  first_name_en, last_name_en, job_title, login_email, phone, tracking_token_hash
) values (
  'da110000-0000-4000-8000-000000000002', 'EXT-QUEUE-001', 'Test vendor',
  'First', 'Last', 'First', 'Last', 'Tester', 'applicant@example.test', '1234567',
  encode(extensions.digest('local-queue-token', 'sha256'), 'hex')
);

insert into public.external_registration_email_outbox (id, application_id, template_key, recipient_email, payload)
values
  ('da110000-0000-4000-8000-000000000003', 'da110000-0000-4000-8000-000000000002',
    'external_registration_applicant_received', 'applicant@example.test', '{"trackingToken":"local-queue-token"}'),
  ('da110000-0000-4000-8000-000000000004', 'da110000-0000-4000-8000-000000000002',
    'external_registration_applicant_result', 'applicant@example.test', '{"status":"APPROVED"}');

do $$
begin
  if has_function_privilege('authenticated', 'public.link_my_line_identity(text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.service_store_verified_line_identity(uuid,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.service_acquire_api_rate_limit(text,integer)', 'EXECUTE')
    or has_function_privilege('anon', 'public.service_claim_external_registration_emails(text,text,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.service_finish_external_registration_email(uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'Client can bypass server-only checks';
  end if;
end
$$;

set local role service_role;
do $$
declare
  rate_key text := repeat('a', 64);
  claim record;
begin
  if not public.service_store_verified_line_identity(
    'da110000-0000-4000-8000-000000000001', 'U11111111111111111111111111111111',
    'https://profile.line-scdn.net/test'
  ) then raise exception 'Verified LINE account was not stored'; end if;

  if not public.service_acquire_api_rate_limit(rate_key, 60000) then
    raise exception 'First request was rate limited';
  end if;
  if public.service_acquire_api_rate_limit(rate_key, 60000) then
    raise exception 'Shared cooldown accepted a second request';
  end if;

  if exists (select 1 from public.service_claim_external_registration_emails('EXT-QUEUE-001', 'wrong')) then
    raise exception 'Invalid tracking token claimed an email';
  end if;
  select * into strict claim
    from public.service_claim_external_registration_emails('EXT-QUEUE-001', 'local-queue-token');
  if claim.template_key <> 'external_registration_applicant_received' then
    raise exception 'Submission request claimed the wrong template';
  end if;
  if exists (select 1 from public.service_claim_external_registration_emails('EXT-QUEUE-001', 'local-queue-token')) then
    raise exception 'Second worker acquired the held lease';
  end if;
  if public.service_finish_external_registration_email(claim.id, gen_random_uuid(), true) then
    raise exception 'Wrong lease could finish a queued email';
  end if;
  if not public.service_finish_external_registration_email(claim.id, claim.lease_id, false) then
    raise exception 'Could not reschedule a failed email';
  end if;
  if exists (select 1 from public.service_claim_external_registration_emails('EXT-QUEUE-001', 'local-queue-token')) then
    raise exception 'Email retried before its next attempt';
  end if;

  select * into strict claim
    from public.service_claim_external_registration_emails(application_id_param => 'da110000-0000-4000-8000-000000000002');
  if claim.template_key <> 'external_registration_applicant_result' or claim.payload ->> 'trackingToken' <> 'local-queue-token' then
    raise exception 'Result email lost its tracking link';
  end if;
  if not public.service_finish_external_registration_email(claim.id, claim.lease_id, true) then
    raise exception 'Result email could not be marked sent';
  end if;
end
$$;
reset role;

update public.api_rate_limits set expires_at = now() - interval '1 second' where key_hash = repeat('a', 64);
update public.external_registration_email_outbox set next_attempt_at = now() - interval '1 second'
where id = 'da110000-0000-4000-8000-000000000003';

set local role service_role;
do $$
declare
  claim record;
begin
  if not public.service_acquire_api_rate_limit(repeat('a', 64), 60000) then
    raise exception 'Expired cooldown did not allow the next request';
  end if;
  select * into strict claim from public.service_claim_external_registration_emails();
  if claim.id <> 'da110000-0000-4000-8000-000000000003' then
    raise exception 'Worker retried an already sent or unexpected email';
  end if;
  if not public.service_finish_external_registration_email(claim.id, claim.lease_id, true) then
    raise exception 'Scheduled retry could not be marked sent';
  end if;
end
$$;
reset role;

rollback;
