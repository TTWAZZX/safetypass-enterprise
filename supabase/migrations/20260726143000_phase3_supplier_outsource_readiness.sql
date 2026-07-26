begin;

create or replace function public.add_my_supplier_outsource_access(
  participant_type_param text,
  work_type_param text,
  access_start_date_param date default null,
  access_end_date_param date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  enabled_value boolean;
  current_access public.user_training_access%rowtype;
  access_changed boolean := false;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.users where id = auth.uid() and coalesce(is_active, false)) then
    raise exception 'Account is unavailable';
  end if;
  select coalesce(sc.value::boolean, false) into enabled_value
  from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if not coalesce(enabled_value, false) then raise exception 'Program registration is not enabled'; end if;
  if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
  if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
  if access_end_date_param is not null and access_start_date_param is not null
     and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;

  select * into current_access
  from public.user_training_access
  where user_id = auth.uid() and program_code = 'SUPPLIER_OUTSOURCE'
  for update;

  if found then
    access_changed := current_access.participant_type is distinct from participant_type_param
      or current_access.work_type is distinct from work_type_param
      or current_access.access_start_date is distinct from access_start_date_param
      or current_access.access_end_date is distinct from access_end_date_param;

    if access_changed then
      update public.supplier_outsource_passes
      set status = 'REVOKED'
      where user_id = auth.uid() and status = 'ACTIVE';
    end if;

    update public.user_training_access
    set participant_type = participant_type_param,
        work_type = work_type_param,
        access_start_date = access_start_date_param,
        access_end_date = access_end_date_param,
        passed_at = case when access_changed then null else passed_at end,
        expires_at = case when access_changed then null else expires_at end,
        updated_at = now()
    where user_id = current_access.user_id
      and program_code = current_access.program_code;
  else
    insert into public.user_training_access(
      user_id, program_code, participant_type, work_type, access_start_date, access_end_date
    ) values (
      auth.uid(), 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
      access_start_date_param, access_end_date_param
    );
  end if;
end;
$$;
revoke all on function public.add_my_supplier_outsource_access(text, text, date, date) from public, anon;
grant execute on function public.add_my_supplier_outsource_access(text, text, date, date) to authenticated, service_role;

create or replace function public.get_my_supplier_outsource_status()
returns table(
  participant_type text, work_type text, access_start_date date, access_end_date date,
  passed_at timestamptz, expires_at timestamptz, last_score integer,
  total_questions integer, last_status text, last_test_at timestamptz,
  verification_token uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.participant_type, a.work_type, a.access_start_date, a.access_end_date,
    a.passed_at, coalesce(pass_result.expires_at, a.expires_at),
    coalesce(pass_result.score, latest_result.score),
    coalesce(pass_result.total_questions, latest_result.total_questions),
    coalesce(pass_result.status, latest_result.status),
    coalesce(pass_result.test_date, latest_result.test_date),
    pass_result.verification_token
  from public.user_training_access a
  left join lateral (
    select p.verification_token, p.expires_at, h.score, h.total_questions,
      h.status, h.created_at as test_date
    from public.supplier_outsource_passes p
    join public.exam_history h on h.id = p.exam_history_id
    where p.user_id = a.user_id and p.status = 'ACTIVE'
    order by p.issued_at desc
    limit 1
  ) pass_result on true
  left join lateral (
    select h.score, h.total_questions, h.status, h.created_at as test_date
    from public.exam_history h
    where h.user_id = a.user_id and h.exam_type = 'SUPPLIER_OUTSOURCE'
    order by h.created_at desc
    limit 1
  ) latest_result on true
  where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
$$;
revoke all on function public.get_my_supplier_outsource_status() from public, anon;
grant execute on function public.get_my_supplier_outsource_status() to authenticated, service_role;

create or replace function public.verify_supplier_outsource_pass(token_param uuid)
returns table(
  name text, vendor_name text, participant_type text, work_type text,
  score integer, total_questions integer, test_date timestamptz,
  expires_at timestamptz, is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.name, v.name, a.participant_type, a.work_type, h.score, h.total_questions,
    h.created_at, p.expires_at,
    coalesce(u.is_active, false)
      and p.status = 'ACTIVE'
      and p.expires_at > now()
      and (a.access_start_date is null or a.access_start_date <= current_date)
      and (a.access_end_date is null or a.access_end_date >= current_date)
  from public.supplier_outsource_passes p
  join public.users u on u.id = p.user_id
  join public.user_training_access a
    on a.user_id = p.user_id and a.program_code = 'SUPPLIER_OUTSOURCE'
  join public.exam_history h on h.id = p.exam_history_id
  left join public.vendors v on v.id = u.vendor_id
  where p.verification_token = token_param
  limit 1
$$;
revoke all on function public.verify_supplier_outsource_pass(uuid) from public;
grant execute on function public.verify_supplier_outsource_pass(uuid) to anon, authenticated, service_role;

create or replace function public.admin_set_supplier_outsource_access(
  user_id_param uuid, enabled_param boolean, participant_type_param text default null,
  work_type_param text default null, access_start_date_param date default null,
  access_end_date_param date default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_access public.user_training_access%rowtype;
  access_changed boolean := false;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if enabled_param then
    if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;

    select * into current_access
    from public.user_training_access
    where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE'
    for update;

    if found then
      access_changed := current_access.participant_type is distinct from participant_type_param
        or current_access.work_type is distinct from work_type_param
        or current_access.access_start_date is distinct from access_start_date_param
        or current_access.access_end_date is distinct from access_end_date_param;

      if access_changed then
        update public.supplier_outsource_passes
        set status = 'REVOKED'
        where user_id = user_id_param and status = 'ACTIVE';
      end if;

      update public.user_training_access
      set participant_type = participant_type_param,
          work_type = work_type_param,
          access_start_date = access_start_date_param,
          access_end_date = access_end_date_param,
          passed_at = case when access_changed then null else passed_at end,
          expires_at = case when access_changed then null else expires_at end,
          updated_at = now()
      where user_id = current_access.user_id
        and program_code = current_access.program_code;
    else
      insert into public.user_training_access(
        user_id, program_code, participant_type, work_type, access_start_date, access_end_date
      ) values (
        user_id_param, 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
        access_start_date_param, access_end_date_param
      );
    end if;
  else
    update public.supplier_outsource_passes set status = 'REVOKED'
    where user_id = user_id_param and status = 'ACTIVE';
    delete from public.user_training_access
    where user_id = user_id_param and program_code = 'SUPPLIER_OUTSOURCE';
  end if;
end;
$$;
revoke all on function public.admin_set_supplier_outsource_access(uuid, boolean, text, text, date, date) from public, anon;
grant execute on function public.admin_set_supplier_outsource_access(uuid, boolean, text, text, date, date) to authenticated, service_role;

create or replace function public.admin_supplier_outsource_report()
returns table(
  user_id uuid, company text, name text, participant_type text, work_type text,
  national_id text, test_date timestamptz, expiration_date timestamptz,
  score integer, total_questions integer, result_status text,
  access_start_date date, access_end_date date, verification_token uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select u.id, coalesce(v.name, '-'), u.name, a.participant_type, a.work_type,
    case
      when u.national_id ~ '^[0-9]{13}$' then u.national_id
      when au.email ~ '^[0-9]{13}@safetypass[.]com$' then split_part(au.email, '@', 1)
      else null
    end,
    coalesce(pass_result.test_date, latest_result.test_date),
    coalesce(pass_result.expires_at, a.expires_at),
    coalesce(pass_result.score, latest_result.score),
    coalesce(pass_result.total_questions, latest_result.total_questions),
    coalesce(pass_result.status, latest_result.status),
    a.access_start_date, a.access_end_date, pass_result.verification_token
  from public.user_training_access a
  join public.users u on u.id = a.user_id
  left join auth.users au on au.id = u.id
  left join public.vendors v on v.id = u.vendor_id
  left join lateral (
    select p.verification_token, p.expires_at, h.score, h.total_questions,
      h.status, h.created_at as test_date
    from public.supplier_outsource_passes p
    join public.exam_history h on h.id = p.exam_history_id
    where p.user_id = a.user_id and p.status = 'ACTIVE'
    order by p.issued_at desc
    limit 1
  ) pass_result on true
  left join lateral (
    select h.score, h.total_questions, h.status, h.created_at as test_date
    from public.exam_history h
    where h.user_id = a.user_id and h.exam_type = 'SUPPLIER_OUTSOURCE'
    order by h.created_at desc
    limit 1
  ) latest_result on true
  where a.program_code = 'SUPPLIER_OUTSOURCE'
  order by coalesce(pass_result.test_date, latest_result.test_date, a.created_at) desc;
end;
$$;
revoke all on function public.admin_supplier_outsource_report() from public, anon;
grant execute on function public.admin_supplier_outsource_report() to authenticated, service_role;

commit;
