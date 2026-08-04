begin;

do $$
begin
  if has_function_privilege('anon', 'public.get_external_registration_email_batch(text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.get_external_registration_email_batch(text,text)', 'execute') then
    raise exception 'Email outbox read function is still client-callable';
  end if;
  if has_function_privilege('anon', 'public.record_external_registration_email_result(uuid,text,boolean,text)', 'execute')
     or has_function_privilege('authenticated', 'public.record_external_registration_email_result(uuid,text,boolean,text)', 'execute') then
    raise exception 'Email delivery state function is still client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.get_external_registration_email_batch(text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.record_external_registration_email_result(uuid,text,boolean,text)', 'execute') then
    raise exception 'Service role cannot operate the email outbox';
  end if;
  if has_function_privilege('authenticated', 'public.add_my_training_access(text[],text,text)', 'execute') then
    raise exception 'Superseded training-access function is still client-callable';
  end if;
  if not has_function_privilege('service_role', 'public.add_my_training_access(text[],text,text)', 'execute') then
    raise exception 'Service role compatibility for legacy training access was lost';
  end if;
  if to_regprocedure('public.submit_exam_attempt(text,jsonb,text)') is not null then
    raise exception 'Legacy exam submission bypass exists';
  end if;
end;
$$;

do $$
declare
  table_name_value text;
begin
  foreach table_name_value in array array[
    'users', 'exam_history', 'exam_logs', 'work_permits', 'questions',
    'vendors', 'system_config', 'audit_logs'
  ] loop
    if has_table_privilege('anon', format('public.%I', table_name_value), 'truncate')
       or has_table_privilege('authenticated', format('public.%I', table_name_value), 'truncate') then
      raise exception 'Client role retains TRUNCATE on %', table_name_value;
    end if;
  end loop;
end;
$$;

rollback;
