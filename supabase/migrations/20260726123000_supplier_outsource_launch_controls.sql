begin;

create or replace function public.admin_get_supplier_outsource_launch_status()
returns table(enabled boolean, active_question_count bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    coalesce((select sc.value::boolean from public.system_config sc
      where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'), false),
    (select count(*) from public.questions q
      where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true);
end;
$$;
revoke all on function public.admin_get_supplier_outsource_launch_status() from public, anon;
grant execute on function public.admin_get_supplier_outsource_launch_status() to authenticated, service_role;

create or replace function public.admin_set_supplier_outsource_feature(enabled_param boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if enabled_param and not exists (
    select 1 from public.questions q
    where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true
  ) then raise exception 'At least one active Supplier and Outsource question is required'; end if;
  insert into public.system_config(key, value)
  values ('SUPPLIER_OUTSOURCE_ENABLED', enabled_param::text)
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.admin_set_supplier_outsource_feature(boolean) from public, anon;
grant execute on function public.admin_set_supplier_outsource_feature(boolean) to authenticated, service_role;

commit;
