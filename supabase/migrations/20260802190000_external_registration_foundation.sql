begin;

-- Phase 1 foundation for the internal request/approval workflow.
-- This migration is additive only. It does not alter the existing login,
-- registration, exam, pass, LINE, or Supplier & Outsource workflows.

insert into public.system_config(key, value)
values ('EXTERNAL_REGISTRATION_ENABLED', 'false')
on conflict (key) do nothing;

create sequence if not exists public.external_access_request_seq;

create table if not exists public.external_access_applications (
  id uuid primary key default gen_random_uuid(),
  request_no text not null unique default (
    'EXT-' || to_char(current_date, 'YYYY') || '-' ||
    lpad(nextval('public.external_access_request_seq')::text, 6, '0')
  ),
  company_name_submitted text not null,
  vendor_id uuid references public.vendors(id) on delete set null,
  company_resolution text not null default 'UNRESOLVED'
    check (company_resolution in (
      'UNRESOLVED', 'MATCHED_EXISTING', 'LINKED_PENDING',
      'CREATED_NEW', 'REJECTED'
    )),
  first_name_th text not null,
  last_name_th text not null,
  first_name_en text not null,
  last_name_en text not null,
  job_title text not null,
  login_email text not null,
  phone text not null,
  status text not null default 'SUBMITTED'
    check (status in (
      'SUBMITTED', 'UNDER_REVIEW', 'NEED_MORE_INFO',
      'APPROVED', 'REJECTED', 'CANCELLED'
    )),
  pdpa_agreed boolean not null default false,
  pdpa_agreed_at timestamptz,
  tracking_token_hash text not null unique,
  admin_note text,
  rejection_reason text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(company_name_submitted)) between 2 and 200),
  check (length(btrim(first_name_th)) between 1 and 120),
  check (length(btrim(last_name_th)) between 1 and 120),
  check (length(btrim(first_name_en)) between 1 and 120),
  check (length(btrim(last_name_en)) between 1 and 120),
  check (length(btrim(job_title)) between 1 and 160),
  check (length(btrim(login_email)) between 3 and 320),
  check (length(btrim(phone)) between 3 and 40),
  check (not pdpa_agreed or pdpa_agreed_at is not null)
);

create table if not exists public.external_application_types (
  application_id uuid not null references public.external_access_applications(id) on delete cascade,
  type_code text not null
    check (type_code in ('CONTRACTOR', 'SUPPLIER', 'OUTSOURCE')),
  target_system text not null
    check (target_system in ('CONTRACTOR_ONLINE', 'SUPPLIER_EPASS')),
  created_at timestamptz not null default now(),
  primary key (application_id, type_code),
  check (
    (type_code = 'CONTRACTOR' and target_system = 'CONTRACTOR_ONLINE')
    or (type_code in ('SUPPLIER', 'OUTSOURCE') and target_system = 'SUPPLIER_EPASS')
  )
);

create table if not exists public.external_application_contacts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.external_access_applications(id) on delete cascade,
  contact_name text not null,
  is_primary boolean not null default false,
  display_order integer not null default 1,
  created_at timestamptz not null default now(),
  check (length(btrim(contact_name)) between 1 and 160),
  unique (application_id, display_order)
);

create table if not exists public.external_application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.external_access_applications(id) on delete cascade,
  from_status text,
  to_status text not null
    check (to_status in (
      'SUBMITTED', 'UNDER_REVIEW', 'NEED_MORE_INFO',
      'APPROVED', 'REJECTED', 'CANCELLED'
    )),
  changed_by uuid references public.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.external_registration_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  email text not null,
  purpose text not null default 'EXTERNAL_REGISTRATION_ADMIN'
    check (purpose = 'EXTERNAL_REGISTRATION_ADMIN'),
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
);

create unique index if not exists external_registration_recipients_email_unique_idx
on public.external_registration_notification_recipients (lower(email), purpose);

create table if not exists public.external_registration_email_outbox (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.external_access_applications(id) on delete cascade,
  template_key text not null,
  recipient_email text not null,
  recipient_name text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SENT', 'FAILED')), 
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists external_access_applications_status_idx
on public.external_access_applications(status, created_at desc);

create index if not exists external_access_applications_vendor_idx
on public.external_access_applications(vendor_id, created_at desc);

create index if not exists external_access_applications_email_idx
on public.external_access_applications(lower(login_email));

create index if not exists external_application_types_type_idx
on public.external_application_types(type_code, application_id);

create index if not exists external_application_contacts_application_idx
on public.external_application_contacts(application_id, display_order);

create index if not exists external_application_status_history_application_idx
on public.external_application_status_history(application_id, created_at desc);

create index if not exists external_registration_email_outbox_status_idx
on public.external_registration_email_outbox(status, next_attempt_at, created_at);

create or replace function public.external_registration_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_external_access_applications_updated_at
on public.external_access_applications;
create trigger trg_external_access_applications_updated_at
before update on public.external_access_applications
for each row execute function public.external_registration_set_updated_at();

drop trigger if exists trg_external_registration_recipients_updated_at
on public.external_registration_notification_recipients;
create trigger trg_external_registration_recipients_updated_at
before update on public.external_registration_notification_recipients
for each row execute function public.external_registration_set_updated_at();

drop trigger if exists trg_external_registration_email_outbox_updated_at
on public.external_registration_email_outbox;
create trigger trg_external_registration_email_outbox_updated_at
before update on public.external_registration_email_outbox
for each row execute function public.external_registration_set_updated_at();

-- Public callers can read only the feature flag. All application data remains
-- inaccessible directly and will be handled through dedicated RPCs in later phases.
create or replace function public.get_external_registration_feature_flag()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sc.value::boolean
    from public.system_config sc
    where sc.key = 'EXTERNAL_REGISTRATION_ENABLED'
  ), false)
$$;

revoke all on function public.get_external_registration_feature_flag() from public;
grant execute on function public.get_external_registration_feature_flag() to anon, authenticated, service_role;

-- New data is private by default. Future public/admin workflows must use
-- purpose-built security-definer RPCs instead of direct table access.
alter table public.external_access_applications enable row level security;
alter table public.external_application_types enable row level security;
alter table public.external_application_contacts enable row level security;
alter table public.external_application_status_history enable row level security;
alter table public.external_registration_notification_recipients enable row level security;
alter table public.external_registration_email_outbox enable row level security;

revoke all on table public.external_access_applications from public, anon, authenticated;
revoke all on table public.external_application_types from public, anon, authenticated;
revoke all on table public.external_application_contacts from public, anon, authenticated;
revoke all on table public.external_application_status_history from public, anon, authenticated;
revoke all on table public.external_registration_notification_recipients from public, anon, authenticated;
revoke all on table public.external_registration_email_outbox from public, anon, authenticated;

grant select, insert, update, delete on table public.external_access_applications to service_role;
grant select, insert, update, delete on table public.external_application_types to service_role;
grant select, insert, update, delete on table public.external_application_contacts to service_role;
grant select, insert, update, delete on table public.external_application_status_history to service_role;
grant select, insert, update, delete on table public.external_registration_notification_recipients to service_role;
grant select, insert, update, delete on table public.external_registration_email_outbox to service_role;
grant usage, select on sequence public.external_access_request_seq to service_role;

revoke all on function public.external_registration_set_updated_at() from public, anon, authenticated;

commit;
