begin;

insert into public.system_config (key, value)
values ('REGISTRATION_INVITATION_REQUIRED', 'false')
on conflict (key) do nothing;

create function public.registration_invitation_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.system_config
    where key = 'REGISTRATION_INVITATION_REQUIRED' and value = 'true'
  )
$$;
revoke all on function public.registration_invitation_required() from public, anon, authenticated;
grant execute on function public.registration_invitation_required() to anon, authenticated, service_role;

create or replace function public.get_auth_login_context(national_id_param text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_exists', true,
    'user_id', u.id,
    'is_active', coalesce(u.is_active, false),
    'pin_version', coalesce(s.pin_version, 1),
    'locked_until', s.locked_until,
    'pin_reset_state', coalesce(s.pin_reset_state, 'NONE'),
    'pin_reset_expires_at', s.pin_reset_expires_at,
    'pin_setup_required', coalesce(s.pin_setup_required, false),
    'registration_invitation_required', public.registration_invitation_required()
  )
  from public.users u
  left join public.user_auth_security s on s.user_id = u.id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by exists (select 1 from auth.users au where au.id = u.id) desc,
           coalesce(u.pdpa_agreed, false) desc,
           u.created_at desc
  limit 1
$$;

create table public.registration_invitations (
  id uuid primary key default gen_random_uuid(),
  identity_fingerprint text not null unique,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table public.registration_invitations enable row level security;
revoke all on public.registration_invitations from public, anon, authenticated;

create function public.admin_issue_registration_invitation(national_id_param text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  fingerprint text;
  invitation_code text := encode(extensions.gen_random_bytes(16), 'hex');
begin
  if not public.is_admin() then raise exception 'Admin access required' using errcode = '42501'; end if;
  if national_id_param is null or national_id_param !~ '^[0-9]{13}$' then
    raise exception 'Invalid national ID';
  end if;
  fingerprint := encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  if exists (
    select 1 from public.users u
    where u.national_id_fingerprint = fingerprint
      and (u.pdpa_agreed is true or u.role is distinct from 'USER' or u.is_active is distinct from true)
  ) then
    raise exception 'This account is not eligible for a registration invitation';
  end if;
  insert into public.registration_invitations (identity_fingerprint, code_hash, expires_at)
  values (fingerprint, encode(extensions.digest(invitation_code, 'sha256'), 'hex'), now() + interval '24 hours')
  on conflict (identity_fingerprint) do update
  set id = gen_random_uuid(), code_hash = excluded.code_hash, expires_at = excluded.expires_at, used_at = null;
  insert into public.audit_logs (actor_user_id, admin_email, action, target, details)
  values (auth.uid(), public.admin_audit_actor_label(auth.uid()), 'ADMIN_REGISTRATION_INVITATION_ISSUED',
    'registration_invitations', '{"expires_in_hours":24}');
  return invitation_code;
end;
$$;
revoke all on function public.admin_issue_registration_invitation(text) from public, anon, authenticated;
grant execute on function public.admin_issue_registration_invitation(text) to authenticated, service_role;

create function public.service_get_registration_invitation(national_id_param text, code_param text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select i.id from public.registration_invitations i
  where i.identity_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
    and i.code_hash = encode(extensions.digest(code_param, 'sha256'), 'hex')
    and i.expires_at > now() and i.used_at is null
$$;
revoke all on function public.service_get_registration_invitation(text, text) from public, anon, authenticated;
grant execute on function public.service_get_registration_invitation(text, text) to service_role;

alter function public.get_my_staged_registration_profile() rename to get_my_staged_registration_profile_internal;
revoke all on function public.get_my_staged_registration_profile_internal() from public, anon, authenticated;

create function public.get_my_staged_registration_profile()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.registration_invitation_required() and not exists (
    select 1 from public.registration_invitations i
    join auth.users au on au.id = auth.uid()
    where i.id::text = auth.jwt() -> 'app_metadata' ->> 'registration_invitation_id'
      and i.identity_fingerprint = encode(extensions.digest(split_part(au.email, '@', 1), 'sha256'), 'hex')
      and i.expires_at > now() and i.used_at is null
  ) then
    raise exception 'Valid registration invitation is required' using errcode = '42501';
  end if;
  return public.get_my_staged_registration_profile_internal();
end;
$$;
revoke all on function public.get_my_staged_registration_profile() from public, anon, authenticated;
grant execute on function public.get_my_staged_registration_profile() to authenticated, service_role;

alter function public.repair_my_orphaned_registration() rename to repair_my_orphaned_registration_internal;
revoke all on function public.repair_my_orphaned_registration_internal() from public, anon, authenticated;

create function public.repair_my_orphaned_registration()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.registration_invitation_required() then
    raise exception 'Profile repair requires verified sign-in' using errcode = '42501';
  end if;
  return public.repair_my_orphaned_registration_internal();
end;
$$;
revoke all on function public.repair_my_orphaned_registration() from public, anon, authenticated;
grant execute on function public.repair_my_orphaned_registration() to authenticated, service_role;

create function public.service_repair_verified_registration(auth_user_id_param uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth_user_id_param is null then raise exception 'Authentication required'; end if;
  perform pg_catalog.set_config('request.jwt.claim.sub', auth_user_id_param::text, true);
  perform pg_catalog.set_config('request.jwt.claims', jsonb_build_object('sub', auth_user_id_param)::text, true);
  return public.repair_my_orphaned_registration_internal();
end;
$$;
revoke all on function public.service_repair_verified_registration(uuid) from public, anon, authenticated;
grant execute on function public.service_repair_verified_registration(uuid) to service_role;

alter function public.complete_registration_v4(text, text, uuid, integer, text, text, text[], text, text, date, date)
  rename to complete_registration_v4_internal;
revoke all on function public.complete_registration_v4_internal(text, text, uuid, integer, text, text, text[], text, text, date, date)
  from public, anon, authenticated;

create function public.complete_registration_v4(
  national_id_param text, name_param text, vendor_id_param uuid default null,
  age_param integer default null, nationality_param text default 'ไทย (Thai)',
  other_vendor_name_param text default null, program_codes_param text[] default array['CONTRACTOR']::text[],
  participant_type_param text default null, work_type_param text default null,
  access_start_date_param date default null, access_end_date_param date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation_id uuid;
  registered_user jsonb;
begin
  if public.registration_invitation_required() then
    update public.registration_invitations i set used_at = now()
    where i.identity_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
      and i.expires_at > now() and i.used_at is null
      and auth.jwt() -> 'app_metadata' ->> 'registration_invitation_id' = i.id::text
    returning i.id into invitation_id;
    if invitation_id is null then
      raise exception 'Valid registration invitation is required' using errcode = '42501';
    end if;
  end if;
  registered_user := public.complete_registration_v4_internal(
    national_id_param, name_param, vendor_id_param, age_param, nationality_param,
    other_vendor_name_param, program_codes_param, participant_type_param, work_type_param,
    access_start_date_param, access_end_date_param
  );
  if invitation_id is not null then
    update public.user_auth_security set pin_setup_required = true where user_id = auth.uid();
  end if;
  return registered_user;
end;
$$;
revoke all on function public.complete_registration_v4(text, text, uuid, integer, text, text, text[], text, text, date, date)
  from public, anon, authenticated;
grant execute on function public.complete_registration_v4(text, text, uuid, integer, text, text, text[], text, text, date, date)
  to authenticated, service_role;

create function public.service_can_set_auth_pin(user_id_param uuid, national_id_param text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u join public.user_auth_security s on s.user_id = u.id
    where u.id = user_id_param and u.is_active is true and u.pdpa_agreed is true
      and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
      and (s.pin_reset_state = 'NONE' or
        (s.pin_reset_state = 'ACTIVE' and s.pin_reset_expires_at > now()))
  )
$$;
revoke all on function public.service_can_set_auth_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.service_can_set_auth_pin(uuid, text) to service_role;

create or replace function public.complete_auth_pin_change(user_id_param uuid, national_id_param text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if national_id_param is null or national_id_param !~ '^[0-9]{13}$' then
    raise exception 'Invalid identity';
  end if;
  update public.users
  set last_login = now()
  where id = user_id_param and is_active is true and pdpa_agreed is true
    and national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  if not found then raise exception 'Identity mismatch'; end if;

  update public.user_auth_security
  set failed_attempts = 0, last_failed_at = null, locked_until = null,
      pin_version = 2, pin_changed_at = now(), pin_setup_required = false,
      pin_reset_state = 'NONE', pin_reset_requested_at = null,
      pin_reset_expires_at = null, pin_reset_by = null, updated_at = now()
  where user_id = user_id_param;
  if not found then raise exception 'Authentication security state not found'; end if;
end;
$$;

create or replace function public.record_auth_login_success(national_id_param text, pin_version_param integer default 1)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
begin
  select u.id into target_id
  from public.users u
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by exists (select 1 from auth.users au where au.id = u.id) desc,
    coalesce(u.pdpa_agreed, false) desc, u.created_at desc
  limit 1;

  -- A successful submission of a temporary PIN does not finish PIN setup.
  update public.users set last_login = now()
  where id = target_id and pdpa_agreed is true and is_active is true
    and exists (
      select 1 from public.user_auth_security s where s.user_id = target_id
        and s.pin_reset_state = 'NONE' and not s.pin_setup_required
    );

  update public.user_auth_security s
  set failed_attempts = 0, last_failed_at = null, locked_until = null,
      pin_version = greatest(s.pin_version, case when pin_version_param = 2 then 2 else 1 end),
      pin_changed_at = case when pin_version_param = 2 and s.pin_version < 2 then now() else s.pin_changed_at end,
      updated_at = now()
  where s.user_id = target_id;
end;
$$;

commit;
