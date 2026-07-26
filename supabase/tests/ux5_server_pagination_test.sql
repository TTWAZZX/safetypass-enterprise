begin;

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'ux5-admin@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'ux5-user@example.test');

insert into public.vendors (id, name, status)
values ('20000000-0000-0000-0000-000000000001', 'UX5 Test Vendor', 'APPROVED');

insert into public.users (id, national_id, name, vendor_id, role, induction_expiry, is_active, last_login)
values
  ('10000000-0000-0000-0000-000000000001', '1000000000001', 'UX5 Admin', null, 'ADMIN', null, true, now()),
  ('10000000-0000-0000-0000-000000000002', '1000000000002', 'UX5 User', '20000000-0000-0000-0000-000000000001', 'USER', now() + interval '1 year', true, now());

insert into public.exam_history (user_id, exam_type, score, total_questions, status, created_at)
values
  ('10000000-0000-0000-0000-000000000002', 'INDUCTION', 10, 10, 'PASSED', now() - interval '2 days'),
  ('10000000-0000-0000-0000-000000000002', 'WORK_PERMIT', 8, 10, 'FAILED', now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000002', 'SUPPLIER_OUTSOURCE', 20, 20, 'PASSED', now());

insert into public.audit_logs (admin_email, action, target, details)
values ('ux5-admin@example.test', 'UX5_TEST', 'pagination', 'temporary test row');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);

do $$
declare
  result jsonb;
begin
  result := public.admin_get_exam_history_page(1, 2, null, null, null, null);
  if (result ->> 'total')::integer <> 3 then raise exception 'Exam total mismatch: %', result; end if;
  if jsonb_array_length(result -> 'rows') <> 2 then raise exception 'Exam page size mismatch: %', result; end if;

  result := public.admin_get_exam_history_page(1, 10, 'UX5 User', 'INDUCTION', 'PASSED', null);
  if (result ->> 'total')::integer <> 1 then raise exception 'Exam filters mismatch: %', result; end if;

  result := public.admin_get_dashboard_summary();
  if (result ->> 'total')::integer <> 3 or (result ->> 'passed')::integer <> 2 then
    raise exception 'Dashboard summary mismatch: %', result;
  end if;

  result := public.admin_get_directory_page('USERS', 1, 10, 'UX5 User', '20000000-0000-0000-0000-000000000001', 'HAS_CERT');
  if (result ->> 'total')::integer <> 1 then raise exception 'User directory filters mismatch: %', result; end if;

  result := public.admin_get_directory_page('VENDORS', 1, 10, 'UX5 Test', null, null);
  if (result ->> 'total')::integer <> 1 then raise exception 'Vendor directory mismatch: %', result; end if;

  result := public.admin_get_directory_page('LOGS', 1, 10, null, null, null);
  if (result ->> 'total')::integer < 1 then raise exception 'Audit directory mismatch: %', result; end if;
end;
$$;

rollback;

