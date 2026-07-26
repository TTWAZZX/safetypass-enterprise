begin;

create or replace function public.admin_set_supplier_outsource_access_bulk(
  user_ids_param uuid[],
  participant_type_param text,
  work_type_param text,
  access_start_date_param date default null,
  access_end_date_param date default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_id_value uuid;
  normalized_start date := coalesce(access_start_date_param, current_date);
  normalized_end date;
  saved_count integer := 0;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if coalesce(cardinality(user_ids_param), 0) = 0 or cardinality(user_ids_param) > 5000 then
    raise exception 'Select between 1 and 5000 users';
  end if;
  if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
  if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;

  normalized_end := coalesce(access_end_date_param, (normalized_start + interval '1 year')::date);
  if normalized_end < normalized_start then raise exception 'Invalid access dates'; end if;

  for user_id_value in select distinct value from unnest(user_ids_param) value loop
    if not exists (
      select 1 from public.users u
      where u.id = user_id_value and coalesce(u.is_active, false) and u.role <> 'ADMIN'
    ) then raise exception 'Selected user is unavailable'; end if;

    perform public.admin_set_supplier_outsource_access(
      user_id_value, true, participant_type_param, work_type_param,
      normalized_start, normalized_end
    );
    saved_count := saved_count + 1;
  end loop;
  return saved_count;
end;
$$;
revoke all on function public.admin_set_supplier_outsource_access_bulk(uuid[], text, text, date, date) from public, anon;
grant execute on function public.admin_set_supplier_outsource_access_bulk(uuid[], text, text, date, date) to authenticated, service_role;

create or replace function public.get_my_supplier_outsource_access_notification()
returns table(
  name text,
  vendor_name text,
  participant_type text,
  work_type text,
  access_start_date date,
  access_end_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.name, coalesce(v.name, 'ไม่มีสังกัด'), a.participant_type, a.work_type,
    a.access_start_date, a.access_end_date
  from public.user_training_access a
  join public.users u on u.id = a.user_id
  left join public.vendors v on v.id = u.vendor_id
  where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
  limit 1
$$;
revoke all on function public.get_my_supplier_outsource_access_notification() from public, anon;
grant execute on function public.get_my_supplier_outsource_access_notification() to authenticated, service_role;

create or replace function public.get_exam_questions(exam_type_param text)
returns table (
  id uuid, type text, pattern text, content_th text, content_en text,
  choices_json jsonb, image_url text, is_active boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if exam_type_param = 'SUPPLIER_OUTSOURCE' then
    if not coalesce((select sc.value::boolean from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'), false) then
      raise exception 'Program is not enabled';
    end if;
    if not exists (
      select 1 from public.user_training_access a
      where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
        and (a.access_start_date is null or a.access_start_date <= current_date)
        and (a.access_end_date is null or a.access_end_date >= current_date)
    ) then raise exception 'Supplier and Outsource access is required'; end if;
    if (select count(*) from public.questions q where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active) < 20 then
      raise exception 'At least 20 active Supplier and Outsource questions are required';
    end if;

    return query
    select q.id, q.type, q.pattern, q.content_th, q.content_en,
      case when jsonb_typeof(q.choices_json) = 'array' then
        coalesce((select jsonb_agg(choice - 'is_correct' - 'correct_answer')
          from jsonb_array_elements(q.choices_json) choice), '[]'::jsonb)
        else '[]'::jsonb end,
      q.image_url, q.is_active
    from public.questions q
    where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true
    order by q.created_at, q.id
    limit 20;
    return;
  end if;

  return query
  select q.id, q.type, q.pattern, q.content_th, q.content_en,
    case when jsonb_typeof(q.choices_json) = 'array' then
      coalesce((select jsonb_agg(choice - 'is_correct' - 'correct_answer')
        from jsonb_array_elements(q.choices_json) choice), '[]'::jsonb)
      else '[]'::jsonb end,
    q.image_url, q.is_active
  from public.questions q
  where q.type = exam_type_param and q.is_active = true
  order by q.created_at, q.id;
end;
$$;

create or replace function public.submit_safety_exam(
  exam_type_param text,
  answers_param jsonb,
  permit_no_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_record record;
  choice_record record;
  answer_value jsonb;
  score_value integer := 0;
  total_value integer := 0;
  threshold_value numeric := 80;
  validity_days integer := 365;
  passed_value boolean;
  result_map jsonb := '{}'::jsonb;
  correct_value boolean;
  history_id uuid;
  pass_token uuid;
  pass_expiry timestamptz;
  access_end date;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.users where id = auth.uid() and coalesce(is_active, false)) then
    raise exception 'Account is unavailable';
  end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if exists (select 1 from public.exam_history where user_id = auth.uid()
    and exam_type = exam_type_param and created_at >= now() - interval '60 seconds') then
    raise exception 'Please wait before submitting another exam';
  end if;
  if exam_type_param = 'WORK_PERMIT' and not exists (
    select 1 from public.users where id = auth.uid() and induction_expiry > now()
  ) then raise exception 'Valid induction is required'; end if;
  if exam_type_param = 'WORK_PERMIT' and (permit_no_param is null or permit_no_param !~ '^[0-9]{10}$') then
    raise exception 'Invalid permit number';
  end if;
  if exam_type_param = 'SUPPLIER_OUTSOURCE' then
    if not coalesce((select sc.value::boolean from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'), false) then
      raise exception 'Program is not enabled';
    end if;
    if (select count(*) from public.questions q where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active) < 20 then
      raise exception 'At least 20 active Supplier and Outsource questions are required';
    end if;
    select a.access_end_date into access_end from public.user_training_access a
    where a.user_id = auth.uid() and a.program_code = 'SUPPLIER_OUTSOURCE'
      and (a.access_start_date is null or a.access_start_date <= current_date)
      and (a.access_end_date is null or a.access_end_date >= current_date);
    if not found then raise exception 'Supplier and Outsource access is required'; end if;
  end if;

  select coalesce(value::numeric, 80) into threshold_value from public.system_config
  where key = case exam_type_param
    when 'INDUCTION' then 'PASSING_SCORE_INDUCTION'
    when 'WORK_PERMIT' then 'PASSING_SCORE_WORK_PERMIT'
    else 'PASSING_SCORE_SUPPLIER_OUTSOURCE' end;

  for question_record in
    select * from public.questions
    where type = exam_type_param and is_active = true
    order by created_at, id
    limit (case when exam_type_param = 'SUPPLIER_OUTSOURCE' then 20 else 2147483647 end)
  loop
    total_value := total_value + 1;
    answer_value := answers_param -> question_record.id::text;
    correct_value := false;
    if answer_value is not null then
      if question_record.pattern = 'SHORT_ANSWER' then
        correct_value := lower(trim(answer_value #>> '{}')) = lower(trim(question_record.choices_json -> 0 ->> 'correct_answer'));
      elsif question_record.pattern = 'MATCHING' then
        correct_value := true;
        for choice_record in select value, ordinality
          from jsonb_array_elements(question_record.choices_json) with ordinality x(value, ordinality)
        loop
          if coalesce((answer_value ->> (choice_record.ordinality - 1)::text)::integer, -1)
             <> choice_record.ordinality - 1 then correct_value := false; end if;
        end loop;
      else
        correct_value := coalesce((answer_value #>> '{}')::integer, -1) = question_record.correct_choice_index;
      end if;
    end if;
    if correct_value then score_value := score_value + 1; end if;
    result_map := result_map || jsonb_build_object(question_record.id::text, correct_value);
  end loop;
  if total_value = 0 then raise exception 'No active questions'; end if;
  passed_value := score_value::numeric * 100 / total_value >= threshold_value;

  insert into public.exam_history(user_id, exam_type, score, total_questions, status)
  values (auth.uid(), exam_type_param, score_value, total_value,
    case when passed_value then 'PASSED' else 'FAILED' end)
  returning id into history_id;
  insert into public.exam_logs(user_id, exam_type, score, passed)
  values (auth.uid(), exam_type_param, score_value, passed_value);

  if passed_value and exam_type_param = 'INDUCTION' then
    update public.users set induction_expiry = date_trunc('day', now()) + interval '1 year 1 day - 1 millisecond'
    where id = auth.uid();
  elsif passed_value and exam_type_param = 'WORK_PERMIT' then
    update public.work_permits set status = 'EXPIRED' where user_id = auth.uid() and status = 'ACTIVE';
    insert into public.work_permits(user_id, permit_no, expire_date, status)
    values (auth.uid(), permit_no_param, date_trunc('day', now()) + interval '5 days - 1 millisecond', 'ACTIVE');
  elsif passed_value and exam_type_param = 'SUPPLIER_OUTSOURCE' then
    select greatest(1, least(3650, coalesce(value::integer, 365))) into validity_days
    from public.system_config where key = 'SUPPLIER_OUTSOURCE_VALIDITY_DAYS';
    pass_expiry := date_trunc('day', now()) + make_interval(days => validity_days) + interval '1 day - 1 millisecond';
    if access_end is not null then
      pass_expiry := least(pass_expiry, access_end::timestamptz + interval '1 day - 1 millisecond');
    end if;
    update public.supplier_outsource_passes set status = 'REVOKED'
    where user_id = auth.uid() and status = 'ACTIVE';
    insert into public.supplier_outsource_passes(user_id, exam_history_id, issued_at, expires_at)
    values (auth.uid(), history_id, now(), pass_expiry)
    returning verification_token into pass_token;
    update public.user_training_access set passed_at = now(), expires_at = pass_expiry, updated_at = now()
    where user_id = auth.uid() and program_code = 'SUPPLIER_OUTSOURCE';
  end if;

  return jsonb_build_object('score', score_value, 'passed', passed_value,
    'perQuestion', result_map, 'verificationToken', pass_token, 'expiresAt', pass_expiry);
end;
$$;
revoke all on function public.get_exam_questions(text) from public, anon;
grant execute on function public.get_exam_questions(text) to authenticated, service_role;
revoke all on function public.submit_safety_exam(text, jsonb, text) from public, anon;
grant execute on function public.submit_safety_exam(text, jsonb, text) to authenticated, service_role;

create or replace function public.admin_set_supplier_outsource_feature(enabled_param boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if enabled_param and (
    select count(*) from public.questions q
    where q.type = 'SUPPLIER_OUTSOURCE' and q.is_active = true
  ) < 20 then raise exception 'At least 20 active Supplier and Outsource questions are required'; end if;
  insert into public.system_config(key, value)
  values ('SUPPLIER_OUTSOURCE_ENABLED', enabled_param::text)
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.admin_set_supplier_outsource_feature(boolean) from public, anon;
grant execute on function public.admin_set_supplier_outsource_feature(boolean) to authenticated, service_role;

commit;
