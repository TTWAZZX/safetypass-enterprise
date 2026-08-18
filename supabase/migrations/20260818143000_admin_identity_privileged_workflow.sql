begin;

alter table public.user_auth_security
  add column if not exists pin_reset_state text not null default 'NONE'
    check (pin_reset_state in ('NONE', 'PENDING', 'ACTIVE')),
  add column if not exists pin_reset_requested_at timestamptz,
  add column if not exists pin_reset_expires_at timestamptz,
  add column if not exists pin_reset_by uuid references public.users(id) on delete set null;

create table if not exists public.admin_identity_access_attempts (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.users(id) on delete restrict,
  target_user_id uuid references public.users(id) on delete restrict,
  operation text not null check (operation in ('REVEAL', 'EXPORT', 'CORRECT', 'RECOVER')),
  outcome text not null default 'STARTED'
    check (outcome in ('STARTED', 'SUCCEEDED', 'DENIED', 'FAILED')),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists admin_identity_access_attempts_actor_operation_idx
on public.admin_identity_access_attempts(actor_user_id, operation, created_at desc);

alter table public.admin_identity_access_attempts enable row level security;
revoke all on table public.admin_identity_access_attempts from public, anon, authenticated;
grant select, insert, update on table public.admin_identity_access_attempts to service_role;

create or replace function public.service_assert_admin_identity_actor(actor_id uuid)
returns public.users
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor public.users%rowtype;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Service role required';
  end if;
  select * into actor from public.users where id = actor_id;
  if actor.id is null or actor.role <> 'ADMIN' or actor.is_active is distinct from true then
    raise exception 'Active admin required';
  end if;
  return actor;
end;
$$;

revoke all on function public.service_assert_admin_identity_actor(uuid)
from public, anon, authenticated;
grant execute on function public.service_assert_admin_identity_actor(uuid) to service_role;

drop function if exists public.service_begin_admin_identity_action(uuid, uuid, text);
create or replace function public.service_begin_admin_identity_action(
  actor_id_param uuid,
  target_id_param uuid,
  operation_param text,
  reason_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt_id_value uuid;
  recent_count integer;
  limit_count integer;
  window_value interval;
  safe_reason text := nullif(btrim(coalesce(reason_param, '')), '');
  actor_email text;
  denial_action text;
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if operation_param not in ('REVEAL', 'EXPORT', 'CORRECT', 'RECOVER') then
    raise exception 'Invalid identity operation';
  end if;
  if target_id_param is not null and not exists (
    select 1 from public.users where id = target_id_param
  ) then raise exception 'User not found'; end if;
  if safe_reason is null or char_length(safe_reason) > 500
     or safe_reason ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' then
    raise exception 'Invalid identity action reason';
  end if;

  limit_count := case operation_param
    when 'REVEAL' then 5
    when 'EXPORT' then 1
    when 'CORRECT' then 3
    else 5
  end;
  window_value := case operation_param
    when 'REVEAL' then interval '5 minutes'
    when 'EXPORT' then interval '10 minutes'
    when 'CORRECT' then interval '1 day'
    else interval '1 hour'
  end;

  perform pg_advisory_xact_lock(hashtext(actor_id_param::text || ':' || operation_param));
  select count(*) into recent_count
  from public.admin_identity_access_attempts a
  where a.actor_user_id = actor_id_param
    and a.operation = operation_param
    and a.created_at > now() - window_value;

  insert into public.admin_identity_access_attempts(
    actor_user_id, target_user_id, operation, outcome, error_code, completed_at
  ) values (
    actor_id_param, target_id_param, operation_param,
    case when recent_count >= limit_count then 'DENIED' else 'STARTED' end,
    case when recent_count >= limit_count then 'RATE_LIMITED' end,
    case when recent_count >= limit_count then now() end
  ) returning id into attempt_id_value;

  if recent_count >= limit_count then
    denial_action := case operation_param
      when 'REVEAL' then 'ADMIN_NATIONAL_ID_REVEAL_DENIED'
      when 'EXPORT' then 'ADMIN_NATIONAL_ID_EXPORT_DENIED'
      else 'ADMIN_NATIONAL_ID_CORRECTION_DENIED'
    end;
    actor_email := coalesce(public.admin_audit_actor_label(actor_id_param), 'unknown');
    insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
    values (
      actor_id_param, actor_email, denial_action,
      case when target_id_param is null then 'identity_export:' || attempt_id_value::text else 'users:' || target_id_param::text end,
      jsonb_build_object(
        'correlation_id', attempt_id_value, 'reason', safe_reason,
        'outcome', 'DENIED', 'error_code', 'RATE_LIMITED', 'values_recorded', false
      )::text
    );
  end if;

  return jsonb_build_object(
    'allowed', recent_count < limit_count,
    'attempt_id', attempt_id_value,
    'error_code', case when recent_count >= limit_count then 'RATE_LIMITED' end
  );
end;
$$;

revoke all on function public.service_begin_admin_identity_action(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.service_begin_admin_identity_action(uuid, uuid, text, text) to service_role;

create or replace function public.service_complete_admin_identity_action(
  attempt_id_param uuid,
  actor_id_param uuid,
  action_param text,
  reason_param text,
  succeeded_param boolean,
  error_code_param text default null,
  metadata_param jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.admin_identity_access_attempts%rowtype;
  actor_email text;
  safe_reason text := nullif(btrim(coalesce(reason_param, '')), '');
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if action_param not in (
    'ADMIN_NATIONAL_ID_REVEAL_SUCCEEDED', 'ADMIN_NATIONAL_ID_REVEAL_DENIED',
    'ADMIN_NATIONAL_ID_EXPORT_SUCCEEDED', 'ADMIN_NATIONAL_ID_EXPORT_DENIED',
    'ADMIN_NATIONAL_ID_CORRECTION_COMPLETED', 'ADMIN_NATIONAL_ID_CORRECTION_ROLLED_BACK',
    'ADMIN_NATIONAL_ID_CORRECTION_RECOVERY_REQUIRED'
  ) then raise exception 'Invalid identity audit action'; end if;
  if safe_reason is null or char_length(safe_reason) > 500
     or safe_reason ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' then
    raise exception 'Invalid identity action reason';
  end if;
  if metadata_param::text ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' then
    raise exception 'Identity audit metadata contains protected data';
  end if;

  select * into attempt
  from public.admin_identity_access_attempts
  where id = attempt_id_param and actor_user_id = actor_id_param
  for update;
  if attempt.id is null then raise exception 'Identity attempt not found'; end if;

  update public.admin_identity_access_attempts
  set outcome = case when succeeded_param then 'SUCCEEDED' else 'DENIED' end,
      error_code = error_code_param,
      completed_at = now()
  where id = attempt.id;

  actor_email := coalesce(public.admin_audit_actor_label(actor_id_param), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id_param,
    actor_email,
    action_param,
    case when attempt.target_user_id is null
      then 'identity_export:' || attempt.id::text
      else 'users:' || attempt.target_user_id::text
    end,
    jsonb_build_object(
      'correlation_id', attempt.id,
      'reason', safe_reason,
      'outcome', case when succeeded_param then 'SUCCEEDED' else 'DENIED' end,
      'error_code', error_code_param,
      'metadata', coalesce(metadata_param, '{}'::jsonb),
      'values_recorded', false
    )::text
  );
end;
$$;

revoke all on function public.service_complete_admin_identity_action(
  uuid, uuid, text, text, boolean, text, jsonb
) from public, anon, authenticated;
grant execute on function public.service_complete_admin_identity_action(
  uuid, uuid, text, text, boolean, text, jsonb
) to service_role;

create or replace function public.service_get_admin_identity_target(
  actor_id_param uuid,
  target_id_param uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target public.users%rowtype;
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  select * into target from public.users where id = target_id_param;
  if target.id is null then raise exception 'User not found'; end if;
  return jsonb_build_object(
    'id', target.id,
    'national_id', target.national_id,
    'name', target.name,
    'role', target.role,
    'is_active', target.is_active,
    'fingerprint', target.national_id_fingerprint
  );
end;
$$;

revoke all on function public.service_get_admin_identity_target(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.service_get_admin_identity_target(uuid, uuid) to service_role;

create or replace function public.service_get_admin_identity_export(
  actor_id_param uuid,
  target_ids_param uuid[]
)
returns table(user_id uuid, national_id text, name text, vendor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if target_ids_param is null or cardinality(target_ids_param) < 1
     or cardinality(target_ids_param) > 100 then
    raise exception 'Export must contain between 1 and 100 users';
  end if;
  return query
  select u.id, u.national_id, u.name, coalesce(v.name, '')
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where u.id = any(target_ids_param)
  order by u.name, u.id;
end;
$$;

revoke all on function public.service_get_admin_identity_export(uuid, uuid[])
from public, anon, authenticated;
grant execute on function public.service_get_admin_identity_export(uuid, uuid[]) to service_role;

create or replace function public.service_prepare_national_id_correction(
  actor_id_param uuid,
  target_id_param uuid,
  new_national_id_param text,
  reason_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.users%rowtype;
  operation_id_value uuid;
  new_fingerprint_value text;
  safe_reason text := nullif(btrim(coalesce(reason_param, '')), '');
  actor_email text;
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if actor_id_param = target_id_param then raise exception 'Administrators cannot correct their own identity'; end if;
  if new_national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if safe_reason is null or char_length(safe_reason) > 500
     or safe_reason ~ '(^|[^0-9])[0-9]{13}([^0-9]|$)' then
    raise exception 'Invalid correction reason';
  end if;

  select * into target from public.users where id = target_id_param for update;
  if target.id is null then raise exception 'User not found'; end if;
  if target.role <> 'USER' then raise exception 'Only USER identities can be corrected'; end if;
  new_fingerprint_value := encode(extensions.digest(new_national_id_param, 'sha256'), 'hex');
  if new_fingerprint_value = target.national_id_fingerprint then raise exception 'National ID is unchanged'; end if;
  if exists (
    select 1 from public.users u
    where u.id <> target.id and u.national_id_fingerprint = new_fingerprint_value
  ) then raise exception 'National ID already exists'; end if;

  insert into public.admin_identity_operations(
    target_user_id, actor_user_id, old_fingerprint, new_fingerprint,
    old_masked_id, new_masked_id, reason
  ) values (
    target.id, actor_id_param, target.national_id_fingerprint, new_fingerprint_value,
    public.mask_national_id(target.national_id), public.mask_national_id(new_national_id_param), safe_reason
  ) returning id into operation_id_value;

  actor_email := coalesce(public.admin_audit_actor_label(actor_id_param), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id_param, actor_email, 'ADMIN_NATIONAL_ID_CORRECTION_PREPARED',
    'users:' || target.id::text,
    jsonb_build_object(
      'correlation_id', operation_id_value,
      'reason', safe_reason,
      'old_masked_id', public.mask_national_id(target.national_id),
      'new_masked_id', public.mask_national_id(new_national_id_param),
      'values_recorded', false
    )::text
  );

  return jsonb_build_object(
    'operation_id', operation_id_value,
    'target_user_id', target.id,
    'old_national_id', target.national_id,
    'new_masked_id', public.mask_national_id(new_national_id_param)
  );
end;
$$;

revoke all on function public.service_prepare_national_id_correction(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.service_prepare_national_id_correction(uuid, uuid, text, text) to service_role;

create or replace function public.service_mark_identity_auth_updated(operation_id_param uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'Service role required'; end if;
  update public.admin_identity_operations
  set status = 'AUTH_UPDATED', auth_updated_at = now(), updated_at = now()
  where id = operation_id_param and status = 'PREPARED';
  if not found then raise exception 'Correction operation is not prepared'; end if;
end;
$$;

revoke all on function public.service_mark_identity_auth_updated(uuid) from public, anon, authenticated;
grant execute on function public.service_mark_identity_auth_updated(uuid) to service_role;

create or replace function public.service_finalize_national_id_correction(
  operation_id_param uuid,
  new_national_id_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.admin_identity_operations%rowtype;
  fingerprint_value text;
  actor_email text;
  expiry_value timestamptz := now() + interval '30 minutes';
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'Service role required'; end if;
  if new_national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  fingerprint_value := encode(extensions.digest(new_national_id_param, 'sha256'), 'hex');
  select * into operation from public.admin_identity_operations where id = operation_id_param for update;
  if operation.id is null or operation.status not in ('AUTH_UPDATED', 'RECOVERY_REQUIRED') then
    raise exception 'Correction operation cannot be finalized';
  end if;
  if fingerprint_value <> operation.new_fingerprint then raise exception 'Correction identity mismatch'; end if;

  update public.users
  set national_id = new_national_id_param,
      national_id_hash = fingerprint_value,
      national_id_fingerprint = fingerprint_value,
      national_id_cipher = null
  where id = operation.target_user_id
    and national_id_fingerprint = operation.old_fingerprint;
  if not found and not exists (
    select 1 from public.users
    where id = operation.target_user_id and national_id_fingerprint = operation.new_fingerprint
  ) then raise exception 'Public identity changed during correction'; end if;

  insert into public.user_auth_security(
    user_id, pin_version, failed_attempts, locked_until, pin_reset_state,
    pin_reset_requested_at, pin_reset_expires_at, pin_reset_by
  ) values (
    operation.target_user_id, 2, 0, null, 'ACTIVE', now(), expiry_value, operation.actor_user_id
  ) on conflict (user_id) do update
  set pin_version = 2, failed_attempts = 0, last_failed_at = null, locked_until = null,
      pin_reset_state = 'ACTIVE', pin_reset_requested_at = now(),
      pin_reset_expires_at = expiry_value, pin_reset_by = operation.actor_user_id,
      updated_at = now();

  update public.admin_identity_operations
  set status = 'COMPLETED', completed_at = now(), updated_at = now(), error_code = null
  where id = operation.id;

  actor_email := coalesce(public.admin_audit_actor_label(operation.actor_user_id), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    operation.actor_user_id, actor_email, 'ADMIN_NATIONAL_ID_CORRECTION_COMPLETED',
    'users:' || operation.target_user_id::text,
    jsonb_build_object(
      'correlation_id', operation.id, 'reason', operation.reason,
      'new_masked_id', operation.new_masked_id,
      'temporary_pin_expires_at', expiry_value, 'values_recorded', false
    )::text
  );
  return jsonb_build_object('operation_id', operation.id, 'status', 'COMPLETED', 'temporary_pin_expires_at', expiry_value);
end;
$$;

revoke all on function public.service_finalize_national_id_correction(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_finalize_national_id_correction(uuid, text) to service_role;

create or replace function public.service_rollback_national_id_correction(
  operation_id_param uuid,
  error_code_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.admin_identity_operations%rowtype;
  actor_email text;
  expiry_value timestamptz := now() + interval '30 minutes';
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'Service role required'; end if;
  select * into operation from public.admin_identity_operations where id = operation_id_param for update;
  if operation.id is null or operation.status not in ('PREPARED', 'AUTH_UPDATED', 'RECOVERY_REQUIRED') then
    raise exception 'Correction operation cannot be rolled back';
  end if;
  if not exists (
    select 1 from public.users where id = operation.target_user_id
      and national_id_fingerprint = operation.old_fingerprint
  ) then raise exception 'Public identity cannot be rolled back automatically'; end if;

  insert into public.user_auth_security(
    user_id, pin_version, failed_attempts, locked_until, pin_reset_state,
    pin_reset_requested_at, pin_reset_expires_at, pin_reset_by
  ) values (
    operation.target_user_id, 2, 0, null, 'ACTIVE', now(), expiry_value, operation.actor_user_id
  ) on conflict (user_id) do update
  set pin_version = 2, failed_attempts = 0, last_failed_at = null, locked_until = null,
      pin_reset_state = 'ACTIVE', pin_reset_requested_at = now(),
      pin_reset_expires_at = expiry_value, pin_reset_by = operation.actor_user_id,
      updated_at = now();

  update public.admin_identity_operations
  set status = 'ROLLED_BACK', completed_at = now(), updated_at = now(), error_code = left(error_code_param, 100)
  where id = operation.id;
  actor_email := coalesce(public.admin_audit_actor_label(operation.actor_user_id), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    operation.actor_user_id, actor_email, 'ADMIN_NATIONAL_ID_CORRECTION_ROLLED_BACK',
    'users:' || operation.target_user_id::text,
    jsonb_build_object(
      'correlation_id', operation.id, 'reason', operation.reason,
      'error_code', left(error_code_param, 100),
      'temporary_pin_expires_at', expiry_value, 'values_recorded', false
    )::text
  );
  return jsonb_build_object('operation_id', operation.id, 'status', 'ROLLED_BACK', 'temporary_pin_expires_at', expiry_value);
end;
$$;

revoke all on function public.service_rollback_national_id_correction(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_rollback_national_id_correction(uuid, text) to service_role;

create or replace function public.service_mark_identity_recovery_required(
  operation_id_param uuid,
  error_code_param text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  operation public.admin_identity_operations%rowtype;
  actor_email text;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'Service role required'; end if;
  update public.admin_identity_operations
  set status = 'RECOVERY_REQUIRED', updated_at = now(), error_code = left(error_code_param, 100)
  where id = operation_id_param and status in ('PREPARED', 'AUTH_UPDATED')
  returning * into operation;
  if operation.id is null then raise exception 'Correction operation cannot enter recovery'; end if;
  actor_email := coalesce(public.admin_audit_actor_label(operation.actor_user_id), 'unknown');
  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    operation.actor_user_id, actor_email, 'ADMIN_NATIONAL_ID_CORRECTION_RECOVERY_REQUIRED',
    'users:' || operation.target_user_id::text,
    jsonb_build_object(
      'correlation_id', operation.id, 'reason', operation.reason,
      'error_code', left(error_code_param, 100), 'values_recorded', false
    )::text
  );
end;
$$;

revoke all on function public.service_mark_identity_recovery_required(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_mark_identity_recovery_required(uuid, text) to service_role;

create or replace function public.service_get_identity_operation(operation_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  operation public.admin_identity_operations%rowtype;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'Service role required'; end if;
  select * into operation from public.admin_identity_operations where id = operation_id_param;
  if operation.id is null then raise exception 'Correction operation not found'; end if;
  return jsonb_build_object(
    'operation_id', operation.id, 'status', operation.status,
    'target_user_id', operation.target_user_id, 'actor_user_id', operation.actor_user_id,
    'old_fingerprint', operation.old_fingerprint, 'new_fingerprint', operation.new_fingerprint,
    'old_masked_id', operation.old_masked_id, 'new_masked_id', operation.new_masked_id
  );
end;
$$;

revoke all on function public.service_get_identity_operation(uuid) from public, anon, authenticated;
grant execute on function public.service_get_identity_operation(uuid) to service_role;

create or replace function public.service_finish_admin_identity_attempt(
  attempt_id_param uuid,
  actor_id_param uuid,
  succeeded_param boolean,
  error_code_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  update public.admin_identity_access_attempts
  set outcome = case when succeeded_param then 'SUCCEEDED' else 'FAILED' end,
      error_code = left(error_code_param, 100), completed_at = now()
  where id = attempt_id_param and actor_user_id = actor_id_param and outcome = 'STARTED';
  if not found then raise exception 'Identity attempt cannot be completed'; end if;
end;
$$;

revoke all on function public.service_finish_admin_identity_attempt(uuid, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.service_finish_admin_identity_attempt(uuid, uuid, boolean, text) to service_role;

create or replace function public.service_fail_prepared_identity_correction(
  operation_id_param uuid,
  error_code_param text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') then raise exception 'Service role required'; end if;
  update public.admin_identity_operations
  set status = 'FAILED', completed_at = now(), updated_at = now(), error_code = left(error_code_param, 100)
  where id = operation_id_param and status = 'PREPARED';
  if not found then raise exception 'Prepared correction cannot be failed'; end if;
end;
$$;

revoke all on function public.service_fail_prepared_identity_correction(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_fail_prepared_identity_correction(uuid, text) to service_role;

commit;
