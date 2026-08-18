begin;

-- Durable, non-sensitive alias ledger for idempotent retries after a legacy
-- public.users profile has been moved to its matching Supabase Auth UUID.
create table if not exists public.user_auth_profile_relinks (
  old_user_id uuid primary key,
  new_user_id uuid not null references public.users(id) on delete restrict,
  repaired_by uuid references public.users(id) on delete set null,
  repair_reason text not null default 'ADMIN_PIN_RESET_AUTH_UUID_MISMATCH'
    check (repair_reason = 'ADMIN_PIN_RESET_AUTH_UUID_MISMATCH'),
  repaired_at timestamptz not null default now()
);

comment on table public.user_auth_profile_relinks is
  'Non-sensitive legacy UUID relink ledger used for idempotent Admin PIN reset recovery.';
comment on column public.user_auth_profile_relinks.old_user_id is
  'Historical public.users UUID. Deliberately not a foreign key because the source profile is removed after atomic relink.';

alter table public.user_auth_profile_relinks enable row level security;
revoke all on table public.user_auth_profile_relinks from public, anon, authenticated;
grant select, insert on table public.user_auth_profile_relinks to service_role;

create or replace function public.service_relink_orphaned_profile_for_pin_reset(
  actor_id_param uuid,
  target_user_id_param uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_user public.users%rowtype;
  canonical_user_id uuid;
  candidate_ids uuid[];
  national_id_value text;
  fingerprint_value text;
  existing_relink public.user_auth_profile_relinks%rowtype;
  reference_row record;
  actor_email text;
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if target_user_id_param is null then raise exception 'User not found'; end if;
  if target_user_id_param = actor_id_param then
    raise exception 'Administrators cannot relink their own identity here';
  end if;

  select * into existing_relink
  from public.user_auth_profile_relinks
  where old_user_id = target_user_id_param;

  if existing_relink.old_user_id is not null then
    if not exists (
      select 1
      from public.users u
      join auth.users au on au.id = u.id
      where u.id = existing_relink.new_user_id
        and u.role = 'USER'
        and u.is_active is true
        and au.email ~ '^[0-9]{13}@safetypass[.]com$'
        and u.national_id_fingerprint = encode(
          extensions.digest(split_part(lower(au.email), '@', 1), 'sha256'), 'hex'
        )
    ) then raise exception 'Existing Auth relink is no longer valid'; end if;

    return jsonb_build_object(
      'status', 'ALREADY_RELINKED',
      'user_id', existing_relink.new_user_id,
      'old_user_id', existing_relink.old_user_id
    );
  end if;

  select * into source_user
  from public.users
  where id = target_user_id_param
  for update;

  if source_user.id is null then raise exception 'User not found'; end if;
  if source_user.role <> 'USER' then raise exception 'Only USER accounts can be relinked'; end if;
  if source_user.is_active is distinct from true then raise exception 'Inactive accounts cannot be relinked'; end if;
  if source_user.pdpa_agreed is distinct from true then raise exception 'Unregistered accounts cannot be relinked'; end if;
  if exists (select 1 from auth.users where id = source_user.id) then
    raise exception 'Profile already has an Auth account';
  end if;

  national_id_value := source_user.national_id;
  if national_id_value !~ '^[0-9]{13}$' then raise exception 'Protected identity is unavailable'; end if;
  fingerprint_value := encode(extensions.digest(national_id_value, 'sha256'), 'hex');
  if source_user.national_id_fingerprint is distinct from fingerprint_value then
    raise exception 'Profile identity fingerprint mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(fingerprint_value, 0));

  select array_agg(au.id order by au.id)
  into candidate_ids
  from auth.users au
  where lower(au.email) = lower(national_id_value || '@safetypass.com');

  if coalesce(cardinality(candidate_ids), 0) <> 1 then
    raise exception 'A unique matching Auth account was not found';
  end if;
  canonical_user_id := candidate_ids[1];

  if canonical_user_id = source_user.id then raise exception 'Profile already has an Auth account'; end if;
  if exists (select 1 from public.users where id = canonical_user_id) then
    raise exception 'Matching Auth account already has a public profile';
  end if;

  -- Release unique identity lookup values, clone every current/future profile
  -- column under the Auth UUID, then repoint every single-column FK discovered
  -- from the catalog. Any failure rolls the entire RPC back.
  update public.users
  set national_id_hash = null,
      national_id_fingerprint = null,
      national_id_cipher = null
  where id = source_user.id;

  insert into public.users
  select (pg_catalog.jsonb_populate_record(
    null::public.users,
    pg_catalog.to_jsonb(source_user) || pg_catalog.jsonb_build_object('id', canonical_user_id)
  )).*;

  -- The PIN-v2 profile trigger creates a default security row for the cloned
  -- UUID. Remove only that just-created default so the source security state
  -- (attempts, lock and reset history) can be moved without a PK conflict.
  delete from public.user_auth_security
  where user_id = canonical_user_id;

  for reference_row in
    select child_ns.nspname as schema_name,
           child.relname as table_name,
           child_column.attname as column_name
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_class parent on parent.oid = constraint_row.confrelid
    join pg_catalog.pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
    join pg_catalog.pg_class child on child.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
    join pg_catalog.pg_attribute child_column
      on child_column.attrelid = child.oid
     and child_column.attnum = constraint_row.conkey[1]
    join pg_catalog.pg_attribute parent_column
      on parent_column.attrelid = parent.oid
     and parent_column.attnum = constraint_row.confkey[1]
    where constraint_row.contype = 'f'
      and parent_ns.nspname = 'public'
      and parent.relname = 'users'
      and parent_column.attname = 'id'
      and cardinality(constraint_row.conkey) = 1
      and cardinality(constraint_row.confkey) = 1
  loop
    execute pg_catalog.format(
      'update %I.%I set %I = $1 where %I = $2',
      reference_row.schema_name,
      reference_row.table_name,
      reference_row.column_name,
      reference_row.column_name
    ) using canonical_user_id, source_user.id;
  end loop;

  delete from public.users where id = source_user.id;

  insert into public.user_auth_profile_relinks(old_user_id, new_user_id, repaired_by)
  values (source_user.id, canonical_user_id, actor_id_param);

  actor_email := coalesce(public.admin_audit_actor_label(actor_id_param), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id_param,
    actor_email,
    'ADMIN_AUTH_PROFILE_RELINKED',
    'users:' || canonical_user_id::text,
    jsonb_build_object(
      'old_user_id', source_user.id,
      'new_user_id', canonical_user_id,
      'reason', 'ADMIN_PIN_RESET_AUTH_UUID_MISMATCH',
      'national_id_recorded', false
    )::text
  );

  return jsonb_build_object(
    'status', 'RELINKED',
    'user_id', canonical_user_id,
    'old_user_id', source_user.id
  );
end;
$$;

revoke all on function public.service_relink_orphaned_profile_for_pin_reset(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.service_relink_orphaned_profile_for_pin_reset(uuid, uuid)
to service_role;

-- Complete the second half of an Admin reset through the same service boundary
-- that updates Supabase Auth. This removes the fragile client-JWT hop between
-- password update and reset activation.
create or replace function public.service_activate_admin_pin_reset(
  actor_id_param uuid,
  user_id_param uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  security_row public.user_auth_security%rowtype;
  actor_email text;
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);

  update public.user_auth_security
  set pin_version = 2,
      pin_reset_state = 'ACTIVE',
      updated_at = now()
  where user_id = user_id_param
    and pin_reset_state = 'PENDING'
    and pin_reset_by = actor_id_param
    and pin_reset_expires_at > now()
  returning * into security_row;
  if security_row.user_id is null then raise exception 'PIN reset is not pending'; end if;

  actor_email := coalesce(public.admin_audit_actor_label(actor_id_param), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id_param,
    actor_email,
    'ADMIN_PIN_RESET',
    'users:' || user_id_param::text,
    jsonb_build_object(
      'temporary_pin_source', 'NATIONAL_ID_LAST_6',
      'expires_at', security_row.pin_reset_expires_at,
      'pin_value_recorded', false,
      'activation_boundary', 'SERVICE_ROLE'
    )::text
  );

  return jsonb_build_object(
    'user_id', security_row.user_id,
    'reset_state', security_row.pin_reset_state,
    'expires_at', security_row.pin_reset_expires_at
  );
end;
$$;

revoke all on function public.service_activate_admin_pin_reset(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.service_activate_admin_pin_reset(uuid, uuid)
to service_role;

-- Called by /api/auth-login only after the submitted last-six PIN has already
-- authenticated successfully against Supabase Auth. This repairs the narrow
-- failure window where Auth changed but the activation response was lost.
create or replace function public.service_recover_prepared_pin_reset(user_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  security_row public.user_auth_security%rowtype;
  actor_email text;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  if not exists (
    select 1
    from public.users u
    join auth.users au on au.id = u.id
    where u.id = user_id_param
      and u.role = 'USER'
      and u.is_active is true
      and au.email ~ '^[0-9]{13}@safetypass[.]com$'
      and au.raw_user_meta_data->>'password_scheme' = 'pin-v2-admin-reset'
      and u.national_id_fingerprint = encode(
        extensions.digest(split_part(lower(au.email), '@', 1), 'sha256'), 'hex'
      )
  ) then raise exception 'Prepared reset Auth identity is invalid'; end if;

  update public.user_auth_security
  set pin_version = 2,
      pin_reset_state = 'ACTIVE',
      updated_at = now()
  where user_id = user_id_param
    and pin_reset_state = 'PENDING'
    and pin_reset_by is not null
    and pin_reset_expires_at > now()
  returning * into security_row;
  if security_row.user_id is null then raise exception 'PIN reset is not recoverable'; end if;

  actor_email := coalesce(public.admin_audit_actor_label(security_row.pin_reset_by), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    security_row.pin_reset_by,
    actor_email,
    'ADMIN_PIN_RESET_ACTIVATION_RECOVERED',
    'users:' || user_id_param::text,
    jsonb_build_object(
      'temporary_pin_source', 'NATIONAL_ID_LAST_6',
      'expires_at', security_row.pin_reset_expires_at,
      'pin_value_recorded', false,
      'recovered_after_authenticated_login', true
    )::text
  );

  return jsonb_build_object(
    'user_id', security_row.user_id,
    'reset_state', security_row.pin_reset_state,
    'expires_at', security_row.pin_reset_expires_at
  );
end;
$$;

revoke all on function public.service_recover_prepared_pin_reset(uuid)
from public, anon, authenticated;
grant execute on function public.service_recover_prepared_pin_reset(uuid)
to service_role;

-- Keep the authenticated compatibility RPC correct for older deployed clients.
create or replace function public.admin_activate_pin_reset(user_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  security_row public.user_auth_security%rowtype;
  admin_email_value text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  update public.user_auth_security
  set pin_version = 2,
      pin_reset_state = 'ACTIVE',
      updated_at = now()
  where user_id = user_id_param
    and pin_reset_state = 'PENDING'
    and pin_reset_by = auth.uid()
    and pin_reset_expires_at > now()
  returning * into security_row;
  if security_row.user_id is null then raise exception 'PIN reset is not pending'; end if;

  admin_email_value := coalesce(public.admin_audit_actor_label(auth.uid()), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    auth.uid(), admin_email_value, 'ADMIN_PIN_RESET',
    'users:' || user_id_param::text,
    jsonb_build_object(
      'temporary_pin_source', 'NATIONAL_ID_LAST_6',
      'expires_at', security_row.pin_reset_expires_at,
      'pin_value_recorded', false,
      'activation_boundary', 'AUTHENTICATED_COMPATIBILITY'
    )::text
  );

  return jsonb_build_object(
    'user_id', security_row.user_id,
    'reset_state', security_row.pin_reset_state,
    'expires_at', security_row.pin_reset_expires_at
  );
end;
$$;

revoke all on function public.admin_activate_pin_reset(uuid) from public, anon;
grant execute on function public.admin_activate_pin_reset(uuid) to authenticated, service_role;

commit;
