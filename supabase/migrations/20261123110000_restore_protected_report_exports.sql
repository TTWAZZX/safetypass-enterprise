begin;

create function public.service_get_report_export_ids(
  actor_id_param uuid,
  report_param text,
  user_ids_param uuid[],
  reason_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  export_ids jsonb;
  safe_reason text := btrim(coalesce(reason_param, ''));
begin
  perform public.service_assert_admin_identity_actor(actor_id_param);
  if coalesce(report_param, '') not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')
     or coalesce(cardinality(user_ids_param), 0) not between 1 and 500
     or safe_reason = '' or char_length(safe_reason) > 500
     or safe_reason ~ '[0-9]{13}' then
    raise exception 'Invalid report export request';
  end if;

  with eligible as (
    select u.id,
      case
        when u.national_id ~ '^[0-9]{13}$' and u.national_id <> repeat('0', 13) then u.national_id
        when au.email ~ '^[0-9]{13}@safetypass[.]com$'
          and split_part(au.email, '@', 1) <> repeat('0', 13)
          and (
            u.national_id_fingerprint = encode(extensions.digest(split_part(au.email, '@', 1), 'sha256'), 'hex')
            or (u.national_id_fingerprint is null and report_param = 'SUPPLIER_OUTSOURCE')
          )
          then split_part(au.email, '@', 1)
      end as national_id
    from public.users u
    left join auth.users au on u.id = au.id
    where u.id = any(user_ids_param)
      and (
        (report_param = 'CONTRACTOR' and exists (
          select 1 from public.exam_history h where h.user_id = u.id
        )) or
        (report_param = 'SUPPLIER_OUTSOURCE' and exists (
          select 1 from public.user_training_access a
          where a.user_id = u.id and a.program_code = 'SUPPLIER_OUTSOURCE'
        ))
      )
  )
  select coalesce(jsonb_object_agg(id::text, national_id) filter (where national_id is not null), '{}'::jsonb)
  into export_ids from eligible;

  insert into public.audit_logs(actor_user_id, admin_email, action, target, details)
  values (
    actor_id_param, coalesce(public.admin_audit_actor_label(actor_id_param), 'unknown'),
    'ADMIN_NATIONAL_ID_EXPORT_SUCCEEDED', 'report_export:' || report_param,
    jsonb_build_object('reason', safe_reason, 'report', report_param,
      'target_count', (select count(*) from jsonb_object_keys(export_ids)), 'values_recorded', false)::text
  );
  return export_ids;
end;
$$;

revoke all on function public.service_get_report_export_ids(uuid, text, uuid[], text)
from public, anon, authenticated;
grant execute on function public.service_get_report_export_ids(uuid, text, uuid[], text) to service_role;

commit;
