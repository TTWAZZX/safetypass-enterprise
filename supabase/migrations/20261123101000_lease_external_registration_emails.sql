begin;

alter table public.external_registration_email_outbox
  add column claim_id uuid,
  add column claim_expires_at timestamptz,
  add constraint external_registration_email_outbox_claim_check
    check ((claim_id is null) = (claim_expires_at is null));

create function public.service_claim_external_registration_emails(
  request_no_param text default null,
  tracking_token_param text default null,
  application_id_param uuid default null
)
returns table(id uuid, lease_id uuid, template_key text, recipient_email text, payload jsonb)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select o.id
    from public.external_registration_email_outbox o
    join public.external_access_applications a on a.id = o.application_id
    where o.status in ('PENDING', 'FAILED') and o.attempts < 5
      and (o.next_attempt_at is null or o.next_attempt_at <= now())
      and (o.claim_expires_at is null or o.claim_expires_at <= now())
      and (
        (request_no_param is null and tracking_token_param is null and application_id_param is null)
        or (application_id_param is not null and request_no_param is null and tracking_token_param is null
          and o.application_id = application_id_param and o.template_key = 'external_registration_applicant_result')
        or (application_id_param is null and request_no_param is not null and tracking_token_param is not null
          and a.request_no = request_no_param
          and a.tracking_token_hash = encode(extensions.digest(tracking_token_param, 'sha256'), 'hex')
          and o.template_key in ('external_registration_admin_notice', 'external_registration_applicant_received'))
      )
    order by o.created_at, o.id
    limit 20 for update of o skip locked
  ), claimed as (
    update public.external_registration_email_outbox o
    set claim_id = gen_random_uuid(), claim_expires_at = now() + interval '10 minutes',
        attempts = o.attempts + 1, updated_at = now()
    from candidates c where c.id = o.id
    returning o.*
  )
  select c.id, c.claim_id, c.template_key, c.recipient_email,
    c.payload || jsonb_strip_nulls(jsonb_build_object('trackingToken', coalesce(
      c.payload ->> 'trackingToken',
      tracking_token_param,
      (select received.payload ->> 'trackingToken'
       from public.external_registration_email_outbox received
       where received.application_id = c.application_id
         and received.template_key = 'external_registration_applicant_received'
       order by received.created_at, received.id limit 1)
    )))
  from claimed c
  order by c.created_at, c.id
$$;
revoke all on function public.service_claim_external_registration_emails(text, text, uuid) from public, anon, authenticated;
grant execute on function public.service_claim_external_registration_emails(text, text, uuid) to service_role;

create function public.service_finish_external_registration_email(
  outbox_id_param uuid, lease_id_param uuid, sent_param boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.external_registration_email_outbox o
  set status = case when sent_param is true then 'SENT' else 'FAILED' end,
      sent_at = case when sent_param is true then now() end,
      last_error = case when sent_param is distinct from true then 'SMTP delivery failed' end,
      next_attempt_at = case when sent_param is distinct from true and o.attempts < 5
        then now() + make_interval(mins => 5 * o.attempts) end,
      claim_id = null, claim_expires_at = null, updated_at = now()
  where o.id = outbox_id_param and o.claim_id = lease_id_param;
  return found;
end;
$$;
revoke all on function public.service_finish_external_registration_email(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.service_finish_external_registration_email(uuid, uuid, boolean) to service_role;

create function public.service_reconcile_expired_email_claims()
returns void
language sql
security definer
set search_path = ''
as $$
  with expired as (
    select id from public.external_registration_email_outbox
    where attempts >= 5 and claim_expires_at <= now()
    order by claim_expires_at limit 100 for update skip locked
  )
  update public.external_registration_email_outbox o
  set status = 'FAILED', last_error = 'Delivery was not confirmed before the last claim expired',
      claim_id = null, claim_expires_at = null, next_attempt_at = null, updated_at = now()
  from expired e where e.id = o.id
$$;
revoke all on function public.service_reconcile_expired_email_claims() from public, anon, authenticated;
grant execute on function public.service_reconcile_expired_email_claims() to service_role;

create function public.protect_external_registration_email_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.claim_id is not null and new.claim_id is not distinct from old.claim_id
    and (new.status is distinct from old.status or new.attempts is distinct from old.attempts) then
    raise exception 'Email is assigned to a delivery worker';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_external_registration_email_claim() from public, anon, authenticated;
create trigger protect_external_registration_email_claim
before update on public.external_registration_email_outbox
for each row execute function public.protect_external_registration_email_claim();

commit;
