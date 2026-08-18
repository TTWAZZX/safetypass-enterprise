begin;

-- The same non-sensitive relink ledger is shared by Admin reset recovery and
-- authenticated legacy first-login recovery. This is additive and preserves
-- the historical UUID without storing the national ID or PIN.
alter table public.user_auth_profile_relinks
  drop constraint if exists user_auth_profile_relinks_repair_reason_check;
alter table public.user_auth_profile_relinks
  add constraint user_auth_profile_relinks_repair_reason_check
  check (repair_reason in (
    'ADMIN_PIN_RESET_AUTH_UUID_MISMATCH',
    'SELF_AUTHENTICATED_LEGACY_LOGIN'
  ));

create or replace function public.repair_my_orphaned_registration()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_user_id uuid := auth.uid();
  auth_email text;
  national_id_value text;
  national_hash text;
  linked_user public.users%rowtype;
  orphaned_user public.users%rowtype;
  candidate_count integer;
  reference_row record;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;

  select lower(au.email) into auth_email
  from auth.users au
  where au.id = auth_user_id;

  if auth_email !~ '^[0-9]{13}@safetypass[.]com$' then
    raise exception 'Authenticated identity is not eligible for repair';
  end if;

  national_id_value := split_part(auth_email, '@', 1);
  national_hash := encode(extensions.digest(national_id_value, 'sha256'), 'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(national_hash, 0));

  select u.* into linked_user
  from public.users u
  where u.id = auth_user_id
  for update;

  -- Safe idempotent retry after a prior repair.
  if linked_user.id is not null then
    if linked_user.national_id_fingerprint = national_hash
       and linked_user.role = 'USER'
       and coalesce(linked_user.pdpa_agreed, false)
       and coalesce(linked_user.is_active, false) then
      return true;
    end if;
    raise exception 'Authenticated profile does not match repair request';
  end if;

  select count(*) into candidate_count
  from public.users u
  where u.id <> auth_user_id
    and u.national_id_fingerprint = national_hash
    and coalesce(u.pdpa_agreed, false);
  if candidate_count <> 1 then raise exception 'A unique repairable profile was not found'; end if;

  select u.* into orphaned_user
  from public.users u
  where u.id <> auth_user_id
    and u.national_id_fingerprint = national_hash
    and coalesce(u.pdpa_agreed, false)
  for update;

  if orphaned_user.role <> 'USER' then raise exception 'Privileged profiles require administrator repair'; end if;
  if not coalesce(orphaned_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if exists (select 1 from auth.users au where au.id = orphaned_user.id) then
    raise exception 'Existing Auth identity cannot be replaced';
  end if;

  -- Release the unique protected-identity values and clone every profile field
  -- under the authenticated Auth UUID. The enclosing RPC is one transaction.
  update public.users
  set national_id_hash = null,
      national_id_fingerprint = null,
      national_id_cipher = null
  where id = orphaned_user.id;

  insert into public.users
  select (pg_catalog.jsonb_populate_record(
    null::public.users,
    pg_catalog.to_jsonb(orphaned_user) || pg_catalog.jsonb_build_object('id', auth_user_id)
  )).*;

  -- The insert trigger creates a default row. Remove that row so the complete
  -- legacy PIN state, locks and reset state can move without a PK collision.
  delete from public.user_auth_security where user_id = auth_user_id;

  -- Discover all current and future single-column foreign keys to users(id),
  -- preserving exam, permit, pass, training, User 360 and audit relationships.
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
    ) using auth_user_id, orphaned_user.id;
  end loop;

  delete from public.users where id = orphaned_user.id;

  insert into public.user_auth_profile_relinks(
    old_user_id, new_user_id, repaired_by, repair_reason
  ) values (
    orphaned_user.id, auth_user_id, null, 'SELF_AUTHENTICATED_LEGACY_LOGIN'
  )
  on conflict (old_user_id) do nothing;

  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    auth_user_id,
    'self-service-auth-repair',
    'LEGACY_AUTH_PROFILE_RELINKED',
    'users:' || auth_user_id::text,
    pg_catalog.jsonb_build_object(
      'profile_migrated', true,
      'reason', 'SELF_AUTHENTICATED_LEGACY_LOGIN',
      'national_id_recorded', false,
      'pin_recorded', false
    )::text
  );

  return true;
end;
$$;

revoke all on function public.repair_my_orphaned_registration()
from public, anon;
grant execute on function public.repair_my_orphaned_registration()
to authenticated, service_role;

commit;
