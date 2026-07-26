begin;

create or replace function public.get_public_support_links()
returns table(manual_url text, support_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sc.value from public.system_config sc where sc.key = 'manual_url'), ''),
    coalesce((select sc.value from public.system_config sc where sc.key = 'support_url'), '')
$$;
revoke all on function public.get_public_support_links() from public;
grant execute on function public.get_public_support_links() to anon, authenticated, service_role;

create or replace function public.get_runtime_system_settings()
returns table(key text, value text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    raise exception 'Authentication required';
  end if;

  return query
  select sc.key, sc.value
  from public.system_config sc
  where sc.key in (
    'PASSING_SCORE_INDUCTION',
    'PASSING_SCORE_WORK_PERMIT',
    'PASSING_SCORE_SUPPLIER_OUTSOURCE',
    'SUPPLIER_OUTSOURCE_VALIDITY_DAYS',
    'manual_url',
    'support_url'
  );
end;
$$;
revoke all on function public.get_runtime_system_settings() from public, anon;
grant execute on function public.get_runtime_system_settings() to authenticated, service_role;

create or replace function public.admin_update_system_setting(key_param text, value_param text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if key_param not in (
    'PASSING_SCORE_INDUCTION',
    'PASSING_SCORE_WORK_PERMIT',
    'PASSING_SCORE_SUPPLIER_OUTSOURCE',
    'SUPPLIER_OUTSOURCE_VALIDITY_DAYS',
    'manual_url',
    'support_url'
  ) then
    raise exception 'Unsupported system setting';
  end if;

  if key_param like 'PASSING_SCORE_%'
     and (value_param !~ '^\d{1,3}$' or value_param::integer < 0 or value_param::integer > 100) then
    raise exception 'Passing score must be between 0 and 100';
  end if;

  if key_param = 'SUPPLIER_OUTSOURCE_VALIDITY_DAYS'
     and (value_param !~ '^\d{1,4}$' or value_param::integer < 1 or value_param::integer > 3650) then
    raise exception 'Validity days must be between 1 and 3650';
  end if;

  if key_param in ('manual_url', 'support_url')
     and value_param <> ''
     and value_param !~* '^https://[^[:space:]]+$' then
    raise exception 'Support links must use HTTPS';
  end if;

  insert into public.system_config(key, value)
  values (key_param, value_param)
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.admin_update_system_setting(text, text) from public, anon;
grant execute on function public.admin_update_system_setting(text, text) to authenticated, service_role;

commit;
