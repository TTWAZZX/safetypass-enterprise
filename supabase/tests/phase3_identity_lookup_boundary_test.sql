do $$
begin
  if has_function_privilege('anon', 'public.check_user_exists(text)', 'execute')
     or has_function_privilege('authenticated', 'public.check_user_exists(text)', 'execute') then
    raise exception 'Browser roles can still enumerate registration identities';
  end if;

  if not has_function_privilege('service_role', 'public.check_user_exists(text)', 'execute') then
    raise exception 'Server role cannot read registration account state';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.complete_registration_v4(text,text,uuid,integer,text,text,text[],text,text,date,date)',
    'execute'
  ) then
    raise exception 'Transactional registration compatibility was removed';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.users'::regclass
      and tgname = 'trg_protect_user_security_fields'
      and tgenabled <> 'D'
      and not tgisinternal
  ) then
    raise exception 'Protected user-field trigger is missing or disabled';
  end if;
end
$$;
