begin;

-- Repair legacy profiles whose public.users row survived but whose matching
-- Supabase Auth identity is missing. The caller must first own an authenticated
-- synthetic identity for the same national ID. Existing Auth accounts, admins,
-- suspended profiles, and staged registrations are deliberately excluded.
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

  -- Idempotent success after a previous repair.
  if linked_user.id is not null then
    if linked_user.national_id_fingerprint = national_hash
       and coalesce(linked_user.pdpa_agreed, false)
       and coalesce(linked_user.is_active, false) then
      return true;
    end if;
    raise exception 'Authenticated profile does not match repair request';
  end if;

  select u.* into orphaned_user
  from public.users u
  where u.id <> auth_user_id
    and u.national_id_fingerprint = national_hash
    and coalesce(u.pdpa_agreed, false)
  order by u.created_at desc
  limit 1
  for update;

  if orphaned_user.id is null then raise exception 'Repairable profile not found'; end if;
  if orphaned_user.role <> 'USER' then raise exception 'Privileged profiles require administrator repair'; end if;
  if not coalesce(orphaned_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if exists (select 1 from auth.users au where au.id = orphaned_user.id) then
    raise exception 'Existing Auth identity cannot be replaced';
  end if;

  -- Release unique identity values on the old row, then clone the complete
  -- profile under auth.uid(). PROTECTED bypasses the encryption trigger while
  -- the saved cipher/hash/fingerprint values are preserved on the new row.
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

  update public.exam_history set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.exam_logs set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.work_permits set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.user_training_access set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.supplier_outsource_passes set user_id = auth_user_id where user_id = orphaned_user.id;
  update public.external_access_applications set reviewed_by = auth_user_id where reviewed_by = orphaned_user.id;
  update public.external_application_status_history set changed_by = auth_user_id where changed_by = orphaned_user.id;
  update public.external_registration_notification_recipients set created_by = auth_user_id where created_by = orphaned_user.id;

  delete from public.users where id = orphaned_user.id;

  insert into public.audit_logs(admin_email, action, target, details)
  values (
    auth_email,
    'ORPHANED_AUTH_PROFILE_REPAIRED',
    auth_user_id::text,
    pg_catalog.jsonb_build_object('profile_migrated', true)::text
  );

  return true;
end;
$$;

revoke all on function public.repair_my_orphaned_registration() from public, anon;
grant execute on function public.repair_my_orphaned_registration() to authenticated, service_role;

commit;
