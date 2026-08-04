begin;

create table if not exists public.user_auth_security (
  user_id uuid primary key references public.users(id) on delete cascade,
  pin_version smallint not null default 1 check (pin_version in (1, 2)),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  last_failed_at timestamptz,
  locked_until timestamptz,
  pin_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_auth_security enable row level security;
revoke all on table public.user_auth_security from public, anon, authenticated;
grant select, insert, update, delete on table public.user_auth_security to service_role;

insert into public.user_auth_security(user_id, pin_version)
select u.id, 1 from public.users u
on conflict (user_id) do nothing;

create or replace function public.initialize_user_auth_security()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_auth_security(user_id, pin_version)
  values (new.id, 1)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.initialize_user_auth_security() from public, anon, authenticated;

drop trigger if exists trg_initialize_user_auth_security on public.users;
create trigger trg_initialize_user_auth_security
after insert on public.users
for each row execute function public.initialize_user_auth_security();

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
    'locked_until', s.locked_until
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
revoke all on function public.get_auth_login_context(text) from public, anon, authenticated;
grant execute on function public.get_auth_login_context(text) to service_role;

create or replace function public.record_auth_login_failure(national_id_param text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  security_row public.user_auth_security%rowtype;
  next_attempts integer;
begin
  select s.* into security_row
  from public.user_auth_security s
  join public.users u on u.id = s.user_id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by exists (select 1 from auth.users au where au.id = u.id) desc,
           coalesce(u.pdpa_agreed, false) desc,
           u.created_at desc
  limit 1
  for update of s;

  if security_row.user_id is null then
    return jsonb_build_object('failed_attempts', 0, 'locked_until', null);
  end if;
  if security_row.locked_until is not null and security_row.locked_until > now() then
    return jsonb_build_object('failed_attempts', security_row.failed_attempts, 'locked_until', security_row.locked_until);
  end if;

  next_attempts := case
    when security_row.last_failed_at is null or security_row.last_failed_at < now() - interval '15 minutes' then 1
    else security_row.failed_attempts + 1
  end;

  update public.user_auth_security
  set failed_attempts = next_attempts,
      last_failed_at = now(),
      locked_until = case when next_attempts >= 5 then now() + interval '15 minutes' else null end,
      updated_at = now()
  where user_id = security_row.user_id
  returning * into security_row;

  return jsonb_build_object(
    'failed_attempts', security_row.failed_attempts,
    'locked_until', security_row.locked_until
  );
end;
$$;
revoke all on function public.record_auth_login_failure(text) from public, anon, authenticated;
grant execute on function public.record_auth_login_failure(text) to service_role;

create or replace function public.record_auth_login_success(
  national_id_param text,
  pin_version_param integer default 1
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with target_user as (
    select u.id
    from public.users u
    where national_id_param ~ '^[0-9]{13}$'
      and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
    order by exists (select 1 from auth.users au where au.id = u.id) desc,
             coalesce(u.pdpa_agreed, false) desc,
             u.created_at desc
    limit 1
  )
  update public.user_auth_security s
  set failed_attempts = 0,
      last_failed_at = null,
      locked_until = null,
      pin_version = greatest(s.pin_version, case when pin_version_param = 2 then 2 else 1 end),
      pin_changed_at = case when pin_version_param = 2 and s.pin_version < 2 then now() else s.pin_changed_at end,
      updated_at = now()
  from target_user u
  where u.id = s.user_id;
end;
$$;
revoke all on function public.record_auth_login_success(text, integer) from public, anon, authenticated;
grant execute on function public.record_auth_login_success(text, integer) to service_role;

commit;
