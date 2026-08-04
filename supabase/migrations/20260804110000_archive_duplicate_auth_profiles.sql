begin;

-- Preserve duplicate profile rows for audit/history while ensuring that only
-- the Auth-linked profile remains eligible for identity lookup and login.
alter table public.users
  add column if not exists identity_merged_into_user_id uuid,
  add column if not exists identity_archived_at timestamptz,
  add column if not exists identity_archive_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.users'::regclass
      and conname = 'users_identity_merged_into_user_id_fkey'
  ) then
    alter table public.users
      add constraint users_identity_merged_into_user_id_fkey
      foreign key (identity_merged_into_user_id)
      references public.users(id)
      on delete restrict;
  end if;
end;
$$;

comment on column public.users.identity_merged_into_user_id is
  'Auth-linked canonical profile when this row was archived as a duplicate identity.';
comment on column public.users.identity_archived_at is
  'Timestamp when this duplicate identity was removed from login lookup.';
comment on column public.users.identity_archive_reason is
  'Machine-readable reason for archiving the profile.';

-- Refuse to guess. Every duplicate fingerprint must have exactly one Auth
-- identity, and privileged duplicate profiles require a manual review.
do $$
begin
  if exists (
    select 1
    from public.users u
    where u.national_id_fingerprint is not null
    group by u.national_id_fingerprint
    having count(*) > 1
       and count(*) filter (where exists (
         select 1 from auth.users au where au.id = u.id
       )) <> 1
  ) then
    raise exception 'Duplicate identity group does not have exactly one Auth-linked canonical profile';
  end if;

  if exists (
    with duplicate_groups as (
      select national_id_fingerprint
      from public.users
      where national_id_fingerprint is not null
      group by national_id_fingerprint
      having count(*) > 1
    )
    select 1
    from public.users u
    join duplicate_groups dg using (national_id_fingerprint)
    left join auth.users au on au.id = u.id
    where au.id is null and u.role = 'ADMIN'
  ) then
    raise exception 'Privileged duplicate profile requires manual review';
  end if;

  if exists (
    with duplicate_groups as (
      select national_id_fingerprint
      from public.users
      where national_id_fingerprint is not null
      group by national_id_fingerprint
      having count(*) > 1
    ), duplicate_profiles as (
      select u.id
      from public.users u
      join duplicate_groups dg using (national_id_fingerprint)
      left join auth.users au on au.id = u.id
      where au.id is null
    )
    select 1 from public.exam_history h join duplicate_profiles d on d.id = h.user_id
    union all
    select 1 from public.exam_logs l join duplicate_profiles d on d.id = l.user_id
    union all
    select 1 from public.work_permits p join duplicate_profiles d on d.id = p.user_id
    union all
    select 1 from public.supplier_outsource_passes p join duplicate_profiles d on d.id = p.user_id
    union all
    select 1 from public.external_access_applications a join duplicate_profiles d on d.id = a.reviewed_by
    union all
    select 1 from public.external_application_status_history h join duplicate_profiles d on d.id = h.changed_by
    union all
    select 1 from public.external_registration_notification_recipients r join duplicate_profiles d on d.id = r.created_by
    limit 1
  ) then
    raise exception 'Duplicate profile has protected history; manual merge is required';
  end if;
end;
$$;

-- Copy only missing entitlements. Existing canonical access always wins, and
-- the source entitlement remains attached to the archived profile for audit.
with duplicate_groups as (
  select national_id_fingerprint
  from public.users
  where national_id_fingerprint is not null
  group by national_id_fingerprint
  having count(*) > 1
), mappings as (
  select duplicate_user.id as duplicate_id, canonical_user.id as canonical_id
  from duplicate_groups dg
  join public.users canonical_user
    on canonical_user.national_id_fingerprint = dg.national_id_fingerprint
  join auth.users canonical_auth on canonical_auth.id = canonical_user.id
  join public.users duplicate_user
    on duplicate_user.national_id_fingerprint = dg.national_id_fingerprint
   and duplicate_user.id <> canonical_user.id
  left join auth.users duplicate_auth on duplicate_auth.id = duplicate_user.id
  where duplicate_auth.id is null
)
insert into public.user_training_access(
  user_id, program_code, participant_type, work_type, passed_at, expires_at,
  created_at, updated_at, access_start_date, access_end_date
)
select
  m.canonical_id, a.program_code, a.participant_type, a.work_type,
  a.passed_at, a.expires_at, a.created_at, a.updated_at,
  a.access_start_date, a.access_end_date
from mappings m
join public.user_training_access a on a.user_id = m.duplicate_id
on conflict (user_id, program_code) do nothing;

with duplicate_groups as (
  select national_id_fingerprint
  from public.users
  where national_id_fingerprint is not null
  group by national_id_fingerprint
  having count(*) > 1
), mappings as (
  select duplicate_user.id as duplicate_id, canonical_user.id as canonical_id
  from duplicate_groups dg
  join public.users canonical_user
    on canonical_user.national_id_fingerprint = dg.national_id_fingerprint
  join auth.users canonical_auth on canonical_auth.id = canonical_user.id
  join public.users duplicate_user
    on duplicate_user.national_id_fingerprint = dg.national_id_fingerprint
   and duplicate_user.id <> canonical_user.id
  left join auth.users duplicate_auth on duplicate_auth.id = duplicate_user.id
  where duplicate_auth.id is null
), archived as (
  update public.users u
  set is_active = false,
      national_id_hash = null,
      national_id_fingerprint = null,
      national_id_cipher = null,
      identity_merged_into_user_id = m.canonical_id,
      identity_archived_at = now(),
      identity_archive_reason = 'DUPLICATE_AUTH_PROFILE'
  from mappings m
  where u.id = m.duplicate_id
  returning u.id, m.canonical_id
)
insert into public.audit_logs(admin_email, action, target, details)
select
  'system@migration.local',
  'DUPLICATE_AUTH_PROFILE_ARCHIVED',
  canonical_id::text,
  jsonb_build_object(
    'archived_profile_id', id,
    'history_preserved_in_place', true,
    'identity_lookup_removed', true
  )::text
from archived;

create unique index if not exists users_national_id_fingerprint_unique
  on public.users(national_id_fingerprint)
  where national_id_fingerprint is not null;

create or replace function public.protect_user_security_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.is_admin()
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.induction_expiry is distinct from old.induction_expiry
       or new.national_id is distinct from old.national_id
       or new.national_id_cipher is distinct from old.national_id_cipher
       or new.national_id_hash is distinct from old.national_id_hash
       or new.national_id_fingerprint is distinct from old.national_id_fingerprint
       or new.pdpa_agreed is distinct from old.pdpa_agreed
       or new.pdpa_agreed_at is distinct from old.pdpa_agreed_at
       or new.line_user_id is distinct from old.line_user_id
       or new.identity_merged_into_user_id is distinct from old.identity_merged_into_user_id
       or new.identity_archived_at is distinct from old.identity_archived_at
       or new.identity_archive_reason is distinct from old.identity_archive_reason
     ) then
    raise exception 'Protected user fields must be changed through an authorized RPC';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_user_security_fields() from public, anon, authenticated;

commit;
