begin;

do $$
begin
  if to_regclass('public.external_access_applications') is null
     or to_regclass('public.external_application_types') is null
     or to_regclass('public.external_application_contacts') is null
     or to_regclass('public.external_application_status_history') is null
     or to_regclass('public.external_registration_notification_recipients') is null
     or to_regclass('public.external_registration_email_outbox') is null then
    raise exception 'External registration foundation tables are incomplete';
  end if;

  if public.get_external_registration_feature_flag() is not false then
    raise exception 'External registration feature must remain disabled by default';
  end if;

  if has_table_privilege('anon', 'public.external_access_applications', 'SELECT')
     or has_table_privilege('authenticated', 'public.external_access_applications', 'SELECT') then
    raise exception 'External application data must not be directly readable by client roles';
  end if;

  if has_table_privilege('anon', 'public.external_registration_email_outbox', 'SELECT')
     or has_table_privilege('authenticated', 'public.external_registration_email_outbox', 'SELECT') then
    raise exception 'Email outbox must not be directly readable by client roles';
  end if;

  if not has_table_privilege('service_role', 'public.external_access_applications', 'INSERT') then
    raise exception 'Service role must be able to write external applications';
  end if;
end;
$$;

rollback;
