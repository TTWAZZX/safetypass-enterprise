begin;

create or replace function public.admin_set_user_role(
  user_id_param uuid,
  role_param text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  desired_role text := upper(btrim(coalesce(role_param, '')));
  target_user public.users%rowtype;
  active_admin_count bigint;
begin
  if actor_id is null or not exists (
    select 1 from public.users
    where id = actor_id and role = 'ADMIN' and is_active is distinct from false
  ) then
    raise exception 'Admin access required';
  end if;

  if desired_role not in ('ADMIN', 'USER') then
    raise exception 'Invalid role';
  end if;

  -- Serialize role changes so concurrent demotions cannot remove every admin.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('admin-user-role-management'));

  select * into target_user
  from public.users
  where id = user_id_param
  for update;

  if target_user.id is null then
    raise exception 'User not found';
  end if;

  if target_user.role = desired_role then
    return jsonb_build_object(
      'changed', false,
      'user_id', target_user.id,
      'role', target_user.role
    );
  end if;

  if target_user.id = actor_id then
    raise exception 'You cannot change your own role';
  end if;

  if desired_role = 'ADMIN' and (
    target_user.is_active is distinct from true
    or target_user.pdpa_agreed is distinct from true
    or target_user.last_login is null
  ) then
    raise exception 'Only active, fully registered users can become admins';
  end if;

  if target_user.role = 'ADMIN' and desired_role = 'USER' then
    select count(*) into active_admin_count
    from public.users
    where role = 'ADMIN'
      and is_active is distinct from false
      and id <> target_user.id;

    if active_admin_count < 1 then
      raise exception 'The last active admin cannot be demoted';
    end if;
  end if;

  update public.users
  set role = desired_role
  where id = target_user.id;

  return jsonb_build_object(
    'changed', true,
    'user_id', target_user.id,
    'previous_role', target_user.role,
    'role', desired_role
  );
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text) from public, anon;
grant execute on function public.admin_set_user_role(uuid, text) to authenticated, service_role;

commit;
