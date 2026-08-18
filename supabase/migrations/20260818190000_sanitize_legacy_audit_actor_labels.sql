begin;

-- Older admin workflows write the Supabase Auth email directly to audit_logs.
-- Synthetic SafetyPass emails contain the national ID, so sanitize at the
-- table boundary before the existing no-full-national-id constraint runs.
-- Keeping this guard central also protects any legacy workflow not yet moved
-- to admin_audit_actor_label().
create or replace function public.sanitize_audit_log_actor_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_actor uuid := auth.uid();
begin
  if new.admin_email ~ '^[0-9]{13}@' then
    new.admin_email := public.mask_national_id(split_part(new.admin_email, '@', 1))
      || '@' || split_part(new.admin_email, '@', 2);

    if new.actor_user_id is null
       and current_actor is not null
       and exists (select 1 from public.users u where u.id = current_actor) then
      new.actor_user_id := current_actor;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.sanitize_audit_log_actor_identity()
from public, anon, authenticated;

drop trigger if exists trg_sanitize_audit_log_actor_identity on public.audit_logs;
create trigger trg_sanitize_audit_log_actor_identity
before insert or update of admin_email on public.audit_logs
for each row execute function public.sanitize_audit_log_actor_identity();

comment on function public.sanitize_audit_log_actor_identity() is
  'Masks synthetic national-ID Auth emails at the audit table boundary and preserves the authenticated actor UUID.';

commit;
