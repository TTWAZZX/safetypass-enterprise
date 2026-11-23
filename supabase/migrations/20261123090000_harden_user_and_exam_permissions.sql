begin;

alter table public.user_auth_security add column pin_setup_required boolean not null default false;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users u
    left join public.user_auth_security s on s.user_id = u.id
    where u.id = auth.uid()
      and u.role = 'ADMIN'
      and u.is_active is true
      and coalesce(s.pin_reset_state, 'NONE') = 'NONE'
      and not coalesce(s.pin_setup_required, false)
      and (s.pin_version = 2 or not exists (
        select 1 from public.system_config where key = 'REGISTRATION_INVITATION_REQUIRED' and value = 'true'
      ))
  )
$$;

revoke insert, update on public.users from public, anon, authenticated;
drop policy if exists users_insert_own on public.users;
drop policy if exists users_update_own_or_admin on public.users;
drop policy if exists users_select_own_or_admin on public.users;

create policy users_select_own on public.users
  for select to authenticated using (id = auth.uid());

create policy users_update_own_profile on public.users
  for update to authenticated
  using (id = auth.uid() and is_active is true)
  with check (id = auth.uid() and is_active is true);

grant update (name, age, date_of_birth, nationality, vendor_id, avatar_url)
  on public.users to authenticated;

create or replace function public.assert_my_exam_access(exam_type_param text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.users u
    left join public.user_auth_security s on s.user_id = u.id
    where u.id = auth.uid() and u.is_active is true and u.pdpa_agreed is true
      and coalesce(s.pin_reset_state, 'NONE') = 'NONE'
      and not coalesce(s.pin_setup_required, false)
      and (s.pin_version = 2 or not exists (
        select 1 from public.system_config where key = 'REGISTRATION_INVITATION_REQUIRED' and value = 'true'
      ))
  ) then
    raise exception 'Account is unavailable' using errcode = '42501';
  end if;

  if exam_type_param in ('INDUCTION', 'WORK_PERMIT') and not exists (
    select 1 from public.user_training_access a
    where a.user_id = auth.uid() and a.program_code = 'CONTRACTOR'
      and (a.access_start_date is null or a.access_start_date <= current_date)
      and (a.access_end_date is null or a.access_end_date >= current_date)
  ) then
    raise exception 'Contractor access is required' using errcode = '42501';
  end if;

  if exam_type_param = 'WORK_PERMIT' and not exists (
    select 1 from public.users u where u.id = auth.uid() and u.induction_expiry > now()
  ) then
    raise exception 'Valid induction is required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_my_exam_access(text) from public, anon, authenticated;

alter function public.get_exam_questions(text) rename to get_exam_questions_internal;
revoke all on function public.get_exam_questions_internal(text) from public, anon, authenticated;

create function public.get_exam_questions(exam_type_param text)
returns table (
  id uuid, type text, pattern text, content_th text, content_en text,
  choices_json jsonb, image_url text, is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_my_exam_access(exam_type_param);
  return query select * from public.get_exam_questions_internal(exam_type_param);
end;
$$;
revoke all on function public.get_exam_questions(text) from public, anon, authenticated;
grant execute on function public.get_exam_questions(text) to authenticated, service_role;

alter function public.submit_safety_exam(text, jsonb, text) rename to submit_safety_exam_internal;
revoke all on function public.submit_safety_exam_internal(text, jsonb, text) from public, anon, authenticated;

create function public.submit_safety_exam(exam_type_param text, answers_param jsonb, permit_no_param text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('exam:' || auth.uid()::text, 0)
  );
  perform public.assert_my_exam_access(exam_type_param);
  if jsonb_typeof(answers_param) is distinct from 'object' then
    raise exception 'Invalid exam answers' using errcode = '22023';
  end if;
  return public.submit_safety_exam_internal(exam_type_param, answers_param, permit_no_param);
end;
$$;
revoke all on function public.submit_safety_exam(text, jsonb, text) from public, anon, authenticated;
grant execute on function public.submit_safety_exam(text, jsonb, text) to authenticated, service_role;

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
  if not public.is_admin() then
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
      and is_active is true
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

commit;
