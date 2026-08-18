begin;

create or replace function public.mask_national_id(national_id_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when national_id_value ~ '^[0-9]{13}$' then
      substring(national_id_value from 1 for 3)
      || '••••••'
      || substring(national_id_value from 10 for 4)
    else 'PROTECTED'
  end
$$;

revoke all on function public.mask_national_id(text) from public, anon;
grant execute on function public.mask_national_id(text) to authenticated, service_role;

-- A service-role-only ledger for the future Auth/Public identity correction
-- saga. Full national IDs are deliberately excluded from this table.
create table if not exists public.admin_identity_operations (
  id uuid primary key default gen_random_uuid(),
  operation_type text not null default 'NATIONAL_ID_CORRECTION'
    check (operation_type = 'NATIONAL_ID_CORRECTION'),
  status text not null default 'PREPARED'
    check (status in (
      'PREPARED', 'AUTH_UPDATED', 'COMPLETED', 'ROLLED_BACK',
      'FAILED', 'RECOVERY_REQUIRED'
    )),
  target_user_id uuid not null references public.users(id) on delete restrict,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  old_fingerprint text not null,
  new_fingerprint text not null,
  old_masked_id text not null,
  new_masked_id text not null,
  reason text not null check (char_length(reason) between 3 and 500),
  error_code text,
  prepared_at timestamptz not null default now(),
  auth_updated_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (old_fingerprint <> new_fingerprint)
);

create unique index if not exists admin_identity_operations_active_target_idx
on public.admin_identity_operations(target_user_id)
where status in ('PREPARED', 'AUTH_UPDATED', 'RECOVERY_REQUIRED');

create unique index if not exists admin_identity_operations_active_fingerprint_idx
on public.admin_identity_operations(new_fingerprint)
where status in ('PREPARED', 'AUTH_UPDATED', 'RECOVERY_REQUIRED');

alter table public.admin_identity_operations enable row level security;
revoke all on table public.admin_identity_operations from public, anon, authenticated;
grant select, insert, update on table public.admin_identity_operations to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.admin_identity_operations'::regclass
      and conname = 'admin_identity_operations_reason_no_national_id'
  ) then
    alter table public.admin_identity_operations
      add constraint admin_identity_operations_reason_no_national_id
      check (reason !~ '(^|[^0-9])[0-9]{13}([^0-9]|$)');
  end if;
end
$$;

-- Keep an immutable actor reference while preventing synthetic Auth emails
-- (national-id@safetypass.com) from leaking a full national ID into audit.
alter table public.audit_logs
  add column if not exists actor_user_id uuid references public.users(id) on delete set null;

create index if not exists audit_logs_actor_user_id_created_at_idx
on public.audit_logs(actor_user_id, created_at desc);

update public.audit_logs audit
set actor_user_id = actor.id
from public.users actor
where audit.actor_user_id is null
  and split_part(lower(audit.admin_email), '@', 1) = actor.national_id;

update public.audit_logs
set admin_email = public.mask_national_id(split_part(admin_email, '@', 1))
  || '@' || split_part(admin_email, '@', 2)
where admin_email ~ '^[0-9]{13}@';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.audit_logs'::regclass
      and conname = 'audit_logs_no_full_national_id_email'
  ) then
    alter table public.audit_logs
      add constraint audit_logs_no_full_national_id_email
      check (admin_email !~ '^[0-9]{13}@');
  end if;
end
$$;

create or replace function public.admin_audit_actor_label(actor_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    case
      when au.email ~ '^[0-9]{13}@' then
        public.mask_national_id(split_part(au.email, '@', 1))
        || '@' || split_part(au.email, '@', 2)
      else au.email
    end,
    'unknown'
  )
  from auth.users au
  where au.id = actor_id
$$;

revoke all on function public.admin_audit_actor_label(uuid) from public, anon, authenticated;

-- Runtime kill switch. It is off by default and can be enabled only after the
-- migration and UI have passed the isolated rollout gates.
insert into public.system_config(key, value)
values ('ADMIN_USER360_ENABLED', 'false')
on conflict (key) do nothing;

create or replace function public.admin_get_user360_feature_flag()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return coalesce((
    select lower(sc.value) = 'true'
    from public.system_config sc
    where sc.key = 'ADMIN_USER360_ENABLED'
  ), false);
end;
$$;

revoke all on function public.admin_get_user360_feature_flag() from public, anon;
grant execute on function public.admin_get_user360_feature_flag() to authenticated, service_role;

create or replace function public.admin_set_user360_feature_flag(enabled_param boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  insert into public.system_config(key, value)
  values ('ADMIN_USER360_ENABLED', case when enabled_param then 'true' else 'false' end)
  on conflict (key) do update set value = excluded.value;

  actor_email := case
    when actor_id is null then 'service_role'
    else coalesce(public.admin_audit_actor_label(actor_id), 'unknown')
  end;
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id,
    actor_email,
    'ADMIN_USER360_FEATURE_TOGGLED',
    'system_config:ADMIN_USER360_ENABLED',
    jsonb_build_object('enabled', enabled_param, 'values_recorded', false)::text
  );
  return enabled_param;
end;
$$;

revoke all on function public.admin_set_user360_feature_flag(boolean) from public, anon;
grant execute on function public.admin_set_user360_feature_flag(boolean) to authenticated, service_role;

-- Replace the legacy directory trigger implementation so every future user
-- or vendor audit uses the protected actor label and immutable actor UUID.
create or replace function public.audit_admin_directory_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email_value text;
  target_id uuid;
  changed_fields text[] := array[]::text[];
  action_value text;
begin
  if actor_id is null or not public.is_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  actor_email_value := coalesce(public.admin_audit_actor_label(actor_id), 'unknown');

  if tg_op = 'INSERT' then
    target_id := new.id;
    changed_fields := array['record_created'];
  elsif tg_op = 'DELETE' then
    target_id := old.id;
    changed_fields := array['record_deleted'];
  else
    target_id := new.id;
    if tg_table_name = 'users' then
      changed_fields := array_remove(array[
        case when new.name is distinct from old.name then 'name' end,
        case when new.age is distinct from old.age then 'age' end,
        case when new.date_of_birth is distinct from old.date_of_birth then 'date_of_birth' end,
        case when new.nationality is distinct from old.nationality then 'nationality' end,
        case when new.vendor_id is distinct from old.vendor_id then 'vendor_id' end,
        case when new.role is distinct from old.role then 'role' end,
        case when new.is_active is distinct from old.is_active then 'is_active' end,
        case when new.induction_expiry is distinct from old.induction_expiry then 'induction_expiry' end,
        case when new.pdpa_agreed is distinct from old.pdpa_agreed then 'pdpa_agreed' end
      ], null);
    elsif tg_table_name = 'vendors' then
      changed_fields := array_remove(array[
        case when new.name is distinct from old.name then 'name' end,
        case when new.status is distinct from old.status then 'status' end
      ], null);
    end if;
  end if;

  if coalesce(cardinality(changed_fields), 0) = 0 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  action_value := case
    when tg_table_name = 'users' and tg_op = 'INSERT' then 'ADMIN_USER_CREATED'
    when tg_table_name = 'users' and tg_op = 'DELETE' then 'ADMIN_USER_DELETED'
    when tg_table_name = 'users' and tg_op = 'UPDATE'
      and changed_fields = array['is_active']::text[]
      and (to_jsonb(old) ->> 'is_active')::boolean is distinct from false
      and (to_jsonb(new) ->> 'is_active')::boolean = false then 'ADMIN_USER_ARCHIVED'
    when tg_table_name = 'users' and tg_op = 'UPDATE'
      and changed_fields = array['is_active']::text[]
      and (to_jsonb(old) ->> 'is_active')::boolean = false
      and (to_jsonb(new) ->> 'is_active')::boolean = true then 'ADMIN_USER_REACTIVATED'
    when tg_table_name = 'users' and tg_op = 'UPDATE'
      and changed_fields = array['induction_expiry']::text[]
      and to_jsonb(new) ->> 'induction_expiry' is null then 'ADMIN_INDUCTION_RESET'
    when tg_table_name = 'users' then 'ADMIN_USER_UPDATED'
    when tg_table_name = 'vendors' and tg_op = 'INSERT' then 'ADMIN_VENDOR_CREATED'
    when tg_table_name = 'vendors' and tg_op = 'DELETE' then 'ADMIN_VENDOR_DELETED'
    when tg_table_name = 'vendors' and tg_op = 'UPDATE'
      and changed_fields = array['status']::text[]
      and to_jsonb(new) ->> 'status' = 'REJECTED' then 'ADMIN_VENDOR_ARCHIVED'
    else 'ADMIN_VENDOR_UPDATED'
  end;

  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id,
    actor_email_value,
    action_value,
    tg_table_name || ':' || target_id::text,
    jsonb_build_object(
      'operation', tg_op,
      'changed_fields', to_jsonb(changed_fields),
      'values_recorded', false
    )::text
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_admin_directory_mutation()
from public, anon, authenticated;

create or replace function public.audit_admin_training_access_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  row_value public.user_training_access%rowtype;
  changed_fields text[] := array[]::text[];
  action_value text;
begin
  if auth.uid() is null or not public.is_admin() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    row_value := old;
  else
    row_value := new;
  end if;
  actor_email := coalesce(public.admin_audit_actor_label(actor_id), 'unknown');

  if tg_op = 'INSERT' then
    action_value := 'ADMIN_TRAINING_PROGRAM_ADDED';
    changed_fields := array['program_code'];
  elsif tg_op = 'DELETE' then
    action_value := 'ADMIN_TRAINING_PROGRAM_REMOVED';
    changed_fields := array['program_code'];
  else
    action_value := 'ADMIN_SUPPLIER_ACCESS_CHANGED';
    changed_fields := array_remove(array[
      case when new.participant_type is distinct from old.participant_type then 'participant_type' end,
      case when new.work_type is distinct from old.work_type then 'work_type' end,
      case when new.access_start_date is distinct from old.access_start_date then 'access_start_date' end,
      case when new.access_end_date is distinct from old.access_end_date then 'access_end_date' end,
      case when new.passed_at is distinct from old.passed_at then 'passed_at' end,
      case when new.expires_at is distinct from old.expires_at then 'expires_at' end
    ], null);
    if coalesce(cardinality(changed_fields), 0) = 0 then return new; end if;
  end if;

  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id,
    coalesce(actor_email, 'unknown'),
    action_value,
    'training_access:' || row_value.user_id::text || ':' || row_value.program_code,
    jsonb_build_object(
      'operation', tg_op,
      'program_code', row_value.program_code,
      'changed_fields', to_jsonb(changed_fields),
      'values_recorded', false
    )::text
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_admin_training_access_mutation()
from public, anon, authenticated;

drop trigger if exists trg_audit_admin_training_access_mutation
on public.user_training_access;
create trigger trg_audit_admin_training_access_mutation
after insert or update or delete on public.user_training_access
for each row execute function public.audit_admin_training_access_mutation();

create or replace function public.audit_admin_supplier_pass_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
begin
  if auth.uid() is null or not public.is_admin()
     or new.status is not distinct from old.status
     or new.status <> 'REVOKED' then
    return new;
  end if;

  actor_email := coalesce(public.admin_audit_actor_label(actor_id), 'unknown');

  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id,
    coalesce(actor_email, 'unknown'),
    'ADMIN_SUPPLIER_PASS_REVOKED',
    'supplier_pass:' || new.user_id::text || ':' || new.id::text,
    jsonb_build_object(
      'user_id', new.user_id,
      'changed_fields', jsonb_build_array('status'),
      'values_recorded', false
    )::text
  );
  return new;
end;
$$;

revoke all on function public.audit_admin_supplier_pass_mutation()
from public, anon, authenticated;

drop trigger if exists trg_audit_admin_supplier_pass_mutation
on public.supplier_outsource_passes;
create trigger trg_audit_admin_supplier_pass_mutation
after update on public.supplier_outsource_passes
for each row execute function public.audit_admin_supplier_pass_mutation();

create or replace function public.admin_get_user360(user_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_user public.users%rowtype;
  result_value jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  select * into target_user
  from public.users
  where id = user_id_param;
  if target_user.id is null then raise exception 'User not found'; end if;

  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', target_user.id,
      'masked_national_id', public.mask_national_id(target_user.national_id),
      'name', target_user.name,
      'age', target_user.age,
      'date_of_birth', target_user.date_of_birth,
      'nationality', target_user.nationality,
      'vendor_id', target_user.vendor_id,
      'vendor', case when v.id is null then null else jsonb_build_object(
        'id', v.id, 'name', v.name, 'status', v.status
      ) end,
      'role', target_user.role,
      'is_active', target_user.is_active,
      'pdpa_agreed', target_user.pdpa_agreed,
      'induction_expiry', target_user.induction_expiry,
      'avatar_url', target_user.avatar_url,
      'line_connected', target_user.line_user_id is not null,
      'created_at', target_user.created_at,
      'last_login', target_user.last_login
    ),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'program_code', a.program_code,
        'participant_type', a.participant_type,
        'work_type', a.work_type,
        'access_start_date', a.access_start_date,
        'access_end_date', a.access_end_date,
        'passed_at', a.passed_at,
        'expires_at', a.expires_at,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      ) order by a.program_code)
      from public.user_training_access a
      where a.user_id = target_user.id
    ), '[]'::jsonb),
    'recent_exams', coalesce((
      select jsonb_agg(to_jsonb(exam_rows) order by exam_rows.created_at desc)
      from (
        select h.id, h.exam_type, h.score, h.total_questions, h.status, h.created_at
        from public.exam_history h
        where h.user_id = target_user.id
        order by h.created_at desc
        limit 10
      ) exam_rows
    ), '[]'::jsonb),
    'recent_work_permits', coalesce((
      select jsonb_agg(to_jsonb(permit_rows) order by permit_rows.created_at desc)
      from (
        select p.id, p.permit_no, p.expire_date, p.status, p.created_at
        from public.work_permits p
        where p.user_id = target_user.id
        order by p.created_at desc
        limit 10
      ) permit_rows
    ), '[]'::jsonb),
    'supplier_passes', coalesce((
      select jsonb_agg(to_jsonb(pass_rows) order by pass_rows.issued_at desc)
      from (
        select sp.id, sp.issued_at, sp.expires_at, sp.status, sp.created_at
        from public.supplier_outsource_passes sp
        where sp.user_id = target_user.id
        order by sp.issued_at desc
        limit 5
      ) pass_rows
    ), '[]'::jsonb),
    'auth_security', (
      select jsonb_build_object(
        'pin_version', s.pin_version,
        'failed_attempts', s.failed_attempts,
        'locked_until', s.locked_until,
        'pin_changed_at', s.pin_changed_at,
        'pin_reset_state', to_jsonb(s) ->> 'pin_reset_state',
        'pin_reset_expires_at', to_jsonb(s) ->> 'pin_reset_expires_at'
      )
      from public.user_auth_security s
      where s.user_id = target_user.id
    ),
    'recent_audit', coalesce((
      select jsonb_agg(to_jsonb(audit_rows) order by audit_rows.created_at desc)
      from (
        select l.id, l.actor_user_id, l.admin_email, l.action, l.target, l.details, l.created_at
        from public.audit_logs l
        where l.target = 'users:' || target_user.id::text
           or l.target like 'training_access:' || target_user.id::text || ':%'
           or l.target like 'supplier_pass:' || target_user.id::text || ':%'
        order by l.created_at desc
        limit 20
      ) audit_rows
    ), '[]'::jsonb)
  ) into result_value
  from public.users u
  left join public.vendors v on v.id = target_user.vendor_id
  where u.id = target_user.id;

  return result_value;
end;
$$;

revoke all on function public.admin_get_user360(uuid) from public, anon;
grant execute on function public.admin_get_user360(uuid) to authenticated, service_role;

create or replace function public.admin_update_user360(
  user_id_param uuid,
  name_param text,
  age_param integer,
  date_of_birth_param date,
  nationality_param text,
  vendor_id_param uuid,
  induction_expiry_param timestamptz,
  program_codes_param text[],
  participant_type_param text default null,
  work_type_param text default null,
  access_start_date_param date default null,
  access_end_date_param date default null,
  reason_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_email text;
  target_user public.users%rowtype;
  normalized_name text := nullif(btrim(coalesce(name_param, '')), '');
  normalized_nationality text := nullif(btrim(coalesce(nationality_param, '')), '');
  normalized_reason text := nullif(btrim(coalesce(reason_param, '')), '');
  normalized_age integer;
  desired_programs text[];
  previous_programs text[];
  changed_fields text[] := array[]::text[];
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if normalized_name is null or char_length(normalized_name) > 200 then raise exception 'Invalid name'; end if;
  if normalized_nationality is null or char_length(normalized_nationality) > 100 then raise exception 'Invalid nationality'; end if;
  if normalized_reason is null or char_length(normalized_reason) > 500 then raise exception 'Change reason is required'; end if;
  if normalized_reason ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' then
    raise exception 'Change reason must not contain a national ID';
  end if;
  if program_codes_param is null then raise exception 'Program selection is required'; end if;
  if exists (
    select 1 from unnest(program_codes_param) p
    where p not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')
  ) then raise exception 'Invalid program code'; end if;

  select coalesce(
    array_agg(distinct selected_program.program_code order by selected_program.program_code),
    array[]::text[]
  )
  into desired_programs
  from unnest(program_codes_param) as selected_program(program_code);

  select * into target_user
  from public.users
  where id = user_id_param
  for update;
  if target_user.id is null then raise exception 'User not found'; end if;
  if target_user.is_active is true and cardinality(desired_programs) = 0 then
    raise exception 'Active users must have at least one training program';
  end if;

  normalized_age := case
    when date_of_birth_param is not null then
      extract(year from age(current_date, date_of_birth_param))::integer
    else age_param
  end;
  if normalized_age is not null and (normalized_age < 1 or normalized_age > 120) then
    raise exception 'Invalid age or date of birth';
  end if;
  if vendor_id_param is not null and not exists (
    select 1 from public.vendors v where v.id = vendor_id_param
  ) then raise exception 'Vendor not found'; end if;

  if 'SUPPLIER_OUTSOURCE' = any(desired_programs) then
    if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;
  end if;

  select coalesce(array_agg(a.program_code order by a.program_code), array[]::text[])
  into previous_programs
  from public.user_training_access a
  where a.user_id = target_user.id;

  changed_fields := array_remove(array[
    case when normalized_name is distinct from target_user.name then 'name' end,
    case when normalized_age is distinct from target_user.age then 'age' end,
    case when date_of_birth_param is distinct from target_user.date_of_birth then 'date_of_birth' end,
    case when normalized_nationality is distinct from target_user.nationality then 'nationality' end,
    case when vendor_id_param is distinct from target_user.vendor_id then 'vendor_id' end,
    case when induction_expiry_param is distinct from target_user.induction_expiry then 'induction_expiry' end,
    case when desired_programs is distinct from previous_programs then 'programs' end
  ], null);

  update public.users
  set name = normalized_name,
      age = normalized_age,
      date_of_birth = date_of_birth_param,
      nationality = normalized_nationality,
      vendor_id = vendor_id_param,
      induction_expiry = induction_expiry_param
  where id = target_user.id;

  -- Add replacements before removals so the deferred invariant remains valid.
  if 'CONTRACTOR' = any(desired_programs) then
    perform public.admin_set_training_access(target_user.id, 'CONTRACTOR', true, null, null);
  end if;
  if 'SUPPLIER_OUTSOURCE' = any(desired_programs) then
    perform public.admin_set_supplier_outsource_access(
      target_user.id, true, participant_type_param, work_type_param,
      access_start_date_param, access_end_date_param
    );
  end if;
  if not ('CONTRACTOR' = any(desired_programs))
     and 'CONTRACTOR' = any(previous_programs) then
    perform public.admin_set_training_access(target_user.id, 'CONTRACTOR', false, null, null);
  end if;
  if not ('SUPPLIER_OUTSOURCE' = any(desired_programs))
     and 'SUPPLIER_OUTSOURCE' = any(previous_programs) then
    perform public.admin_set_supplier_outsource_access(
      target_user.id, false, null, null, null, null
    );
  end if;

  actor_email := coalesce(public.admin_audit_actor_label(actor_id), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id,
    coalesce(actor_email, 'unknown'),
    'ADMIN_USER360_UPDATED',
    'users:' || target_user.id::text,
    jsonb_build_object(
      'changed_fields', to_jsonb(changed_fields),
      'programs_before', to_jsonb(previous_programs),
      'programs_after', to_jsonb(desired_programs),
      'reason', normalized_reason,
      'values_recorded', false
    )::text
  );

  return public.admin_get_user360(target_user.id);
end;
$$;

revoke all on function public.admin_update_user360(
  uuid, text, integer, date, text, uuid, timestamptz, text[],
  text, text, date, date, text
) from public, anon;
grant execute on function public.admin_update_user360(
  uuid, text, integer, date, text, uuid, timestamptz, text[],
  text, text, date, date, text
) to authenticated, service_role;

-- Preserve the directory RPC signature while removing full national IDs from
-- its response. Search still happens server-side against the protected value.
create or replace function public.admin_get_directory_page(
  p_section text,
  p_page integer default 1,
  p_page_size integer default 10,
  p_search text default null,
  p_vendor_filter text default null,
  p_cert_filter text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_section text := upper(coalesce(p_section, ''));
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 5000);
  normalized_search text := nullif(btrim(coalesce(p_search, '')), '');
  result jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  if safe_section = 'USERS' then
    with filtered as materialized (
      select
        u.id,
        public.mask_national_id(u.national_id) as national_id,
        u.name,
        u.vendor_id,
        u.role,
        u.induction_expiry,
        u.created_at,
        u.age,
        u.nationality,
        u.pdpa_agreed,
        u.is_active,
        u.date_of_birth,
        u.avatar_url,
        u.last_login,
        case when v.id is null then null else jsonb_build_object('name', v.name) end as vendors,
        case
          when (u.induction_expiry is null or u.induction_expiry <= now()) and u.last_login is not null then 0
          when (u.induction_expiry is null or u.induction_expiry <= now()) then 1
          when u.induction_expiry <= now() + interval '30 days' then 2
          else 3
        end as sort_order
      from public.users u
      left join public.vendors v on v.id = u.vendor_id
      where (normalized_search is null
        or u.name ilike '%' || normalized_search || '%'
        or u.national_id ilike '%' || normalized_search || '%')
        and (p_vendor_filter is null or p_vendor_filter = ''
          or (p_vendor_filter = 'EXTERNAL' and u.vendor_id is null)
          or (p_vendor_filter <> 'EXTERNAL' and u.vendor_id::text = p_vendor_filter))
        and (p_cert_filter is null or p_cert_filter = ''
          or (p_cert_filter = 'NO_CERT' and (u.induction_expiry is null or u.induction_expiry <= now()))
          or (p_cert_filter = 'EXPIRING' and u.induction_expiry > now() and u.induction_expiry <= now() + interval '30 days')
          or (p_cert_filter = 'HAS_CERT' and u.induction_expiry > now() + interval '30 days'))
    ), page_rows as (
      select * from filtered
      order by sort_order, created_at desc
      limit safe_page_size offset (safe_page - 1) * safe_page_size
    ), stats as (
      select jsonb_build_object(
        'total', count(*),
        'noCert', count(*) filter (where induction_expiry is null),
        'expired', count(*) filter (where induction_expiry is not null and induction_expiry <= now()),
        'expiring', count(*) filter (where induction_expiry > now() and induction_expiry <= now() + interval '30 days'),
        'valid', count(*) filter (where induction_expiry > now() + interval '30 days')
      ) as data from public.users
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) - 'sort_order' order by sort_order, created_at desc) from page_rows), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'stats', (select data from stats)
    ) into result;
  elsif safe_section = 'VENDORS' then
    with filtered as materialized (
      select v.id, v.name, v.status, v.created_at
      from public.vendors v
      where normalized_search is null or v.name ilike '%' || normalized_search || '%'
    ), page_rows as (
      select * from filtered order by created_at desc
      limit safe_page_size offset (safe_page - 1) * safe_page_size
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc) from page_rows), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'stats', null
    ) into result;
  elsif safe_section = 'LOGS' then
    with filtered as materialized (
      select l.* from public.audit_logs l
    ), page_rows as (
      select * from filtered order by created_at desc
      limit safe_page_size offset (safe_page - 1) * safe_page_size
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(to_jsonb(page_rows) order by created_at desc) from page_rows), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'stats', null
    ) into result;
  else
    raise exception 'Unsupported directory section';
  end if;

  return result || jsonb_build_object('page', safe_page, 'page_size', safe_page_size);
end;
$$;

revoke all on function public.admin_get_directory_page(
  text, integer, integer, text, text, text
) from public, anon;
grant execute on function public.admin_get_directory_page(
  text, integer, integer, text, text, text
) to authenticated, service_role;

commit;
