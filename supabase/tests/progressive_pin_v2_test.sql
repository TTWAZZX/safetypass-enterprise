do $$
begin
  if has_table_privilege('anon', 'public.user_auth_security', 'SELECT') then
    raise exception 'Anonymous callers can read authentication security state';
  end if;
  if has_function_privilege('anon', 'public.get_auth_login_context(text)', 'EXECUTE') then
    raise exception 'Anonymous callers can inspect authentication login context';
  end if;
  if not has_function_privilege('service_role', 'public.get_auth_login_context(text)', 'EXECUTE') then
    raise exception 'Service role cannot inspect authentication login context';
  end if;
  if (select count(*) from public.user_auth_security) <> (select count(*) from public.users) then
    raise exception 'Existing users were not backfilled exactly once';
  end if;
  if exists (select 1 from public.user_auth_security where pin_version <> 1) then
    raise exception 'Existing accounts were not kept in legacy-compatible PIN state';
  end if;
end;
$$;

insert into public.users(
  id, national_id, name, role, pdpa_agreed, pdpa_agreed_at, is_active,
  national_id_hash, national_id_fingerprint
) values (
  '89999999-9999-4999-8999-999999999991',
  '1888888888888',
  'Progressive PIN Test User',
  'USER',
  true,
  now(),
  true,
  encode(extensions.digest('1888888888888', 'sha256'), 'hex'),
  encode(extensions.digest('1888888888888', 'sha256'), 'hex')
);

do $$
begin
  if not exists (
    select 1 from public.user_auth_security
    where user_id = '89999999-9999-4999-8999-999999999991'
      and pin_version = 1
  ) then raise exception 'New-user authentication security trigger did not run'; end if;
end;
$$;

set local role service_role;
do $$
declare
  context jsonb;
  failure jsonb;
begin
  context := public.get_auth_login_context('1888888888888');
  if context->>'user_exists' <> 'true' or context->>'pin_version' <> '1' then
    raise exception 'Login context did not preserve legacy compatibility';
  end if;

  for attempt_no in 1..5 loop
    failure := public.record_auth_login_failure('1888888888888');
  end loop;
  if (failure->>'failed_attempts')::integer <> 5 or failure->>'locked_until' is null then
    raise exception 'Persistent five-attempt lockout was not applied';
  end if;

  perform public.record_auth_login_success('1888888888888', 2);
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1 from public.user_auth_security
    where user_id = '89999999-9999-4999-8999-999999999991'
      and pin_version = 2
      and failed_attempts = 0
      and locked_until is null
      and pin_changed_at is not null
  ) then raise exception 'Successful PIN v2 authentication did not clear the lockout'; end if;
end;
$$;
