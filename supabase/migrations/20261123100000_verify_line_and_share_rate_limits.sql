begin;

revoke execute on function public.link_my_line_identity(text) from public, anon, authenticated;

alter table public.users add column line_identity_verified_at timestamptz;

create function public.service_store_verified_line_identity(
  user_id_param uuid, line_user_id_param text, picture_url_param text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if line_user_id_param is null or line_user_id_param !~ '^U[0-9a-fA-F]{32}$' then
    raise exception 'Invalid LINE account';
  end if;
  update public.users u
  set line_user_id = line_user_id_param,
      line_identity_verified_at = now(),
      avatar_url = coalesce(picture_url_param, u.avatar_url)
  where u.id = user_id_param and u.is_active is true and u.pdpa_agreed is true
    and exists (
      select 1 from public.user_auth_security s
      where s.user_id = u.id and s.pin_reset_state = 'NONE' and not s.pin_setup_required
        and (s.pin_version = 2 or not public.registration_invitation_required())
    );
  return found;
end;
$$;
revoke all on function public.service_store_verified_line_identity(uuid, text, text) from public, anon, authenticated;
grant execute on function public.service_store_verified_line_identity(uuid, text, text) to service_role;

create table public.api_rate_limits (
  key_hash text primary key,
  expires_at timestamptz not null
);
alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;
create index api_rate_limits_expires_at_idx on public.api_rate_limits (expires_at);

create function public.service_acquire_api_rate_limit(key_hash_param text, interval_ms_param integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := clock_timestamp();
  acquired boolean;
begin
  if key_hash_param is null or key_hash_param !~ '^[0-9a-f]{64}$'
    or interval_ms_param is null or interval_ms_param not between 1 and 3600000 then
    raise exception 'Invalid rate limit arguments';
  end if;
  insert into public.api_rate_limits (key_hash, expires_at)
  values (key_hash_param, now_at + interval_ms_param * interval '1 millisecond')
  on conflict (key_hash) do update set expires_at = excluded.expires_at
  where api_rate_limits.expires_at <= now_at;
  acquired := found;

  with expired as (
    select key_hash from public.api_rate_limits where expires_at <= now_at
    order by expires_at limit 32 for update skip locked
  )
  delete from public.api_rate_limits r using expired e where r.key_hash = e.key_hash;
  return acquired;
end;
$$;
revoke all on function public.service_acquire_api_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.service_acquire_api_rate_limit(text, integer) to service_role;

commit;
