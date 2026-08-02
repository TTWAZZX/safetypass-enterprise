begin;

-- Phase 2 admin-only controls for the external registration email workflow.
-- Email credentials remain server-side; the UI only manages recipients and the
-- feature flag. No client role receives direct table access.

create or replace function public.get_my_admin_status()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
$$;

revoke all on function public.get_my_admin_status() from public, anon;
grant execute on function public.get_my_admin_status() to authenticated, service_role;

create or replace function public.admin_get_external_registration_notification_recipients()
returns table(
  id uuid,
  display_name text,
  email text,
  purpose text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  return query
  select r.id, r.display_name, r.email, r.purpose, r.is_active,
    r.created_at, r.updated_at
  from public.external_registration_notification_recipients r
  where r.purpose = 'EXTERNAL_REGISTRATION_ADMIN'
  order by r.is_active desc, lower(r.email), r.created_at;
end;
$$;

revoke all on function public.admin_get_external_registration_notification_recipients() from public, anon;
grant execute on function public.admin_get_external_registration_notification_recipients() to authenticated, service_role;

create or replace function public.admin_save_external_registration_notification_recipient(
  recipient_id_param uuid default null,
  display_name_param text default null,
  email_param text default null,
  is_active_param boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_id uuid;
  normalized_email text := lower(btrim(coalesce(email_param, '')));
  normalized_name text := nullif(btrim(coalesce(display_name_param, '')), '');
  admin_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    raise exception 'Invalid email address';
  end if;
  if length(normalized_email) > 320 then raise exception 'Email address is too long'; end if;
  if normalized_name is not null and length(normalized_name) > 160 then
    raise exception 'Display name is too long';
  end if;

  if recipient_id_param is null then
    insert into public.external_registration_notification_recipients(
      display_name, email, purpose, is_active, created_by
    ) values (
      normalized_name, normalized_email, 'EXTERNAL_REGISTRATION_ADMIN',
      coalesce(is_active_param, true), auth.uid()
    ) returning id into result_id;
    admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
    insert into public.audit_logs(admin_email, action, target, details)
    values (
      admin_email, 'EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_ADDED', result_id::text,
      jsonb_build_object('email', normalized_email, 'is_active', coalesce(is_active_param, true))::text
    );
  else
    update public.external_registration_notification_recipients
    set display_name = normalized_name,
        email = normalized_email,
        is_active = coalesce(is_active_param, true)
    where id = recipient_id_param
      and purpose = 'EXTERNAL_REGISTRATION_ADMIN'
    returning id into result_id;

    if result_id is null then raise exception 'Email recipient not found'; end if;
    admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
    insert into public.audit_logs(admin_email, action, target, details)
    values (
      admin_email, 'EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_UPDATED', result_id::text,
      jsonb_build_object('email', normalized_email, 'is_active', coalesce(is_active_param, true))::text
    );
  end if;

  return result_id;
exception
  when unique_violation then
    raise exception 'Email recipient already exists';
end;
$$;

revoke all on function public.admin_save_external_registration_notification_recipient(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_save_external_registration_notification_recipient(uuid, text, text, boolean) to authenticated, service_role;

create or replace function public.admin_remove_external_registration_notification_recipient(
  recipient_id_param uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_email text;
  recipient_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  update public.external_registration_notification_recipients
  set is_active = false
  where id = recipient_id_param
    and purpose = 'EXTERNAL_REGISTRATION_ADMIN'
  returning email into recipient_email;

  if recipient_email is null then raise exception 'Email recipient not found'; end if;
  admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email, 'EXTERNAL_REGISTRATION_EMAIL_RECIPIENT_DISABLED', recipient_id_param::text,
    jsonb_build_object('email', recipient_email)::text
  );
end;
$$;

revoke all on function public.admin_remove_external_registration_notification_recipient(uuid) from public, anon;
grant execute on function public.admin_remove_external_registration_notification_recipient(uuid) to authenticated, service_role;

create or replace function public.admin_set_external_registration_feature(enabled_param boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_email text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  insert into public.system_config(key, value)
  values ('EXTERNAL_REGISTRATION_ENABLED', case when coalesce(enabled_param, false) then 'true' else 'false' end)
  on conflict (key) do update
    set value = excluded.value;

  admin_email := coalesce((select au.email from auth.users au where au.id = auth.uid()), 'unknown');
  insert into public.audit_logs(admin_email, action, target, details)
  values (
    admin_email, 'EXTERNAL_REGISTRATION_FEATURE_TOGGLED', 'EXTERNAL_REGISTRATION_ENABLED',
    jsonb_build_object('enabled', coalesce(enabled_param, false))::text
  );
end;
$$;

revoke all on function public.admin_set_external_registration_feature(boolean) from public, anon;
grant execute on function public.admin_set_external_registration_feature(boolean) to authenticated, service_role;

commit;
