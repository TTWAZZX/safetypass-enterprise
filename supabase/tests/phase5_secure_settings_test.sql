begin;

insert into public.system_config(key, value) values
  ('manual_url', 'https://example.com/guide'),
  ('support_url', 'https://example.com/support')
on conflict (key) do update set value = excluded.value;

set local role anon;
select * from public.get_public_support_links();

do $$
begin
  begin
    perform * from public.get_runtime_system_settings();
    raise exception 'Anonymous runtime settings access should fail';
  exception when others then
    if sqlerrm = 'Anonymous runtime settings access should fail' then raise; end if;
  end;
end;
$$;

reset role;
select set_config('request.jwt.claim.role', 'service_role', true);
select public.admin_update_system_setting('PASSING_SCORE_SUPPLIER_OUTSOURCE', '80');

do $$
begin
  begin
    perform public.admin_update_system_setting('UNSUPPORTED_KEY', 'value');
    raise exception 'Unsupported key should fail';
  exception when others then
    if sqlerrm = 'Unsupported key should fail' then raise; end if;
  end;
end;
$$;

rollback;
