begin;

-- Active users must retain at least one assigned training program. The trigger
-- is deferred so registration and future atomic program switches can add the
-- replacement program in the same transaction before this invariant is checked.
create or replace function public.enforce_active_user_training_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := old.user_id;
begin
  if exists (
    select 1
    from public.users u
    where u.id = target_user_id
      and u.is_active is true
  ) and not exists (
    select 1
    from public.user_training_access a
    where a.user_id = target_user_id
  ) then
    raise exception 'Active users must have at least one training program';
  end if;

  return old;
end;
$$;

revoke all on function public.enforce_active_user_training_access()
from public, anon, authenticated;

drop trigger if exists trg_require_active_user_training_access
on public.user_training_access;
create constraint trigger trg_require_active_user_training_access
after delete on public.user_training_access
deferrable initially deferred
for each row execute function public.enforce_active_user_training_access();

create or replace function public.enforce_training_access_on_user_activation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active is true and not exists (
    select 1
    from public.user_training_access a
    where a.user_id = new.id
  ) then
    raise exception 'Active users must have at least one training program';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_training_access_on_user_activation()
from public, anon, authenticated;

drop trigger if exists trg_require_training_access_on_user_activation
on public.users;
create constraint trigger trg_require_training_access_on_user_activation
after insert or update of is_active on public.users
deferrable initially deferred
for each row execute function public.enforce_training_access_on_user_activation();

-- Keep the legacy generic RPC callable for backward compatibility, but route
-- Supplier mutations through the authoritative Supplier RPC so pass revocation
-- and access-window rules cannot be bypassed.
create or replace function public.admin_set_training_access(
  user_id_param uuid,
  program_code_param text,
  enabled_param boolean,
  participant_type_param text default null,
  work_type_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user public.users%rowtype;
  existing_supplier_access public.user_training_access%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if program_code_param not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE') then
    raise exception 'Invalid program code';
  end if;

  select * into target_user
  from public.users
  where id = user_id_param
  for update;
  if target_user.id is null then raise exception 'User not found'; end if;

  if program_code_param = 'SUPPLIER_OUTSOURCE' then
    select * into existing_supplier_access
    from public.user_training_access
    where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE';

    perform public.admin_set_supplier_outsource_access(
      user_id_param,
      enabled_param,
      participant_type_param,
      work_type_param,
      existing_supplier_access.access_start_date,
      existing_supplier_access.access_end_date
    );
    return;
  end if;

  if enabled_param then
    insert into public.user_training_access(user_id, program_code)
    values (user_id_param, 'CONTRACTOR')
    on conflict (user_id, program_code) do nothing;
    return;
  end if;

  if target_user.is_active is true and not exists (
    select 1
    from public.user_training_access a
    where a.user_id = user_id_param
      and a.program_code <> 'CONTRACTOR'
  ) then
    raise exception 'Active users must have at least one training program';
  end if;

  if exists (
    select 1
    from public.work_permits p
    where p.user_id = user_id_param
      and p.status = 'ACTIVE'
      and p.expire_date > now()
  ) then
    raise exception 'Active Work Permit must be revoked or expired before removing Contractor access';
  end if;

  delete from public.user_training_access
  where user_id = user_id_param and program_code = 'CONTRACTOR';
end;
$$;

revoke all on function public.admin_set_training_access(uuid, text, boolean, text, text)
from public, anon;
grant execute on function public.admin_set_training_access(uuid, text, boolean, text, text)
to authenticated, service_role;

create or replace function public.admin_set_supplier_outsource_access(
  user_id_param uuid,
  enabled_param boolean,
  participant_type_param text default null,
  work_type_param text default null,
  access_start_date_param date default null,
  access_end_date_param date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user public.users%rowtype;
  current_access public.user_training_access%rowtype;
  access_changed boolean := false;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into target_user
  from public.users
  where id = user_id_param
  for update;
  if target_user.id is null then raise exception 'User not found'; end if;

  if enabled_param then
    if participant_type_param not in ('supplier', 'outsource') then
      raise exception 'Invalid participant type';
    end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then
      raise exception 'Invalid work type';
    end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then
      raise exception 'Invalid access dates';
    end if;

    select * into current_access
    from public.user_training_access
    where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE'
    for update;

    if found then
      access_changed := current_access.participant_type is distinct from participant_type_param
        or current_access.work_type is distinct from work_type_param
        or current_access.access_start_date is distinct from access_start_date_param
        or current_access.access_end_date is distinct from access_end_date_param;

      if access_changed then
        update public.supplier_outsource_passes
        set status = 'REVOKED'
        where user_id = user_id_param and status = 'ACTIVE';
      end if;

      update public.user_training_access
      set participant_type = participant_type_param,
          work_type = work_type_param,
          access_start_date = access_start_date_param,
          access_end_date = access_end_date_param,
          passed_at = case when access_changed then null else passed_at end,
          expires_at = case when access_changed then null else expires_at end,
          updated_at = now()
      where user_id = current_access.user_id
        and program_code = current_access.program_code;
    else
      insert into public.user_training_access(
        user_id, program_code, participant_type, work_type,
        access_start_date, access_end_date
      ) values (
        user_id_param, 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
        access_start_date_param, access_end_date_param
      );
    end if;
    return;
  end if;

  if target_user.is_active is true and not exists (
    select 1
    from public.user_training_access a
    where a.user_id = user_id_param
      and a.program_code <> 'SUPPLIER_OUTSOURCE'
  ) then
    raise exception 'Active users must have at least one training program';
  end if;

  update public.supplier_outsource_passes
  set status = 'REVOKED'
  where user_id = user_id_param and status = 'ACTIVE';

  delete from public.user_training_access
  where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE';
end;
$$;

revoke all on function public.admin_set_supplier_outsource_access(
  uuid, boolean, text, text, date, date
) from public, anon;
grant execute on function public.admin_set_supplier_outsource_access(
  uuid, boolean, text, text, date, date
) to authenticated, service_role;

commit;
