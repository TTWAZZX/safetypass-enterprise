begin;

alter table public.user_training_access
  add column if not exists access_start_date date,
  add column if not exists access_end_date date;

alter table public.user_training_access
  drop constraint if exists user_training_access_access_dates_check;
alter table public.user_training_access
  add constraint user_training_access_access_dates_check
  check (access_end_date is null or access_start_date is null or access_end_date >= access_start_date);

alter table public.users add column if not exists line_user_id text;
create unique index if not exists users_line_user_id_unique_idx
on public.users(line_user_id) where line_user_id is not null;

create table public.supplier_outsource_passes (
  id uuid primary key default gen_random_uuid(),
  verification_token uuid not null unique default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  exam_history_id uuid not null unique references public.exam_history(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'REVOKED')),
  created_at timestamptz not null default now(),
  check (expires_at > issued_at)
);

create index supplier_outsource_passes_user_idx
on public.supplier_outsource_passes(user_id, issued_at desc);
create index supplier_outsource_passes_active_expiry_idx
on public.supplier_outsource_passes(expires_at)
where status = 'ACTIVE';

alter table public.supplier_outsource_passes enable row level security;
create policy supplier_pass_select_own_or_admin
on public.supplier_outsource_passes for select to authenticated
using (user_id = auth.uid() or public.is_admin());
create policy supplier_pass_admin_update
on public.supplier_outsource_passes for update to authenticated
using (public.is_admin()) with check (public.is_admin());

revoke all on table public.supplier_outsource_passes from public, anon, authenticated;
grant select on table public.supplier_outsource_passes to authenticated;

insert into public.system_config(key, value) values
  ('PASSING_SCORE_SUPPLIER_OUTSOURCE', '80'),
  ('SUPPLIER_OUTSOURCE_VALIDITY_DAYS', '365')
on conflict (key) do nothing;

create or replace function public.get_public_feature_flags()
returns table(supplier_outsource_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select sc.value::boolean
    from public.system_config sc
    where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED'
  ), false)
$$;
revoke all on function public.get_public_feature_flags() from public;
grant execute on function public.get_public_feature_flags() to anon, authenticated, service_role;

create or replace function public.protect_user_security_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.is_admin()
     and (
       new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.induction_expiry is distinct from old.induction_expiry
       or new.national_id is distinct from old.national_id
       or new.national_id_cipher is distinct from old.national_id_cipher
       or new.national_id_hash is distinct from old.national_id_hash
       or new.national_id_fingerprint is distinct from old.national_id_fingerprint
       or new.pdpa_agreed is distinct from old.pdpa_agreed
       or new.pdpa_agreed_at is distinct from old.pdpa_agreed_at
       or new.line_user_id is distinct from old.line_user_id
     ) then
    raise exception 'Protected user fields must be changed through an authorized RPC';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_user_security_fields() from public, anon, authenticated;

create or replace function public.link_my_line_identity(line_user_id_param text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if line_user_id_param !~ '^U[0-9A-Fa-f]{32}$' then raise exception 'Invalid LINE user ID'; end if;
  update public.users set line_user_id = line_user_id_param where id = auth.uid();
end;
$$;
revoke all on function public.link_my_line_identity(text) from public, anon;
grant execute on function public.link_my_line_identity(text) to authenticated, service_role;

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

  insert into public.user_training_access(
    user_id, program_code, participant_type, work_type, access_start_date, access_end_date
  ) values (
    auth.uid(), 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
    access_start_date_param, access_end_date_param
  )
  on conflict (user_id, program_code) do update
  set participant_type = excluded.participant_type,
      work_type = excluded.work_type,
      access_start_date = excluded.access_start_date,
      access_end_date = excluded.access_end_date,
      updated_at = now();
end;
$$;
revoke all on function public.add_my_supplier_outsource_access(text, text, date, date) from public, anon;
grant execute on function public.add_my_supplier_outsource_access(text, text, date, date) to authenticated, service_role;

create or replace function public.complete_registration_v2(
  national_id_param text,
  name_param text,
  vendor_id_param uuid default null,
  age_param integer default null,
  nationality_param text default 'ไทย (Thai)',
  other_vendor_name_param text default null,
  program_codes_param text[] default array['CONTRACTOR']::text[],
  participant_type_param text default null,
  work_type_param text default null,
  access_start_date_param date default null,
  access_end_date_param date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_user_id uuid := auth.uid();
  auth_email text;
  national_hash text;
  linked_user public.users%rowtype;
  staged_user public.users%rowtype;
  final_vendor_id uuid := vendor_id_param;
  result_value jsonb;
  enabled_value boolean;
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if nullif(trim(name_param), '') is null then raise exception 'Name is required'; end if;
  if age_param is not null and (age_param < 0 or age_param > 120) then raise exception 'Invalid age'; end if;
  if program_codes_param is null or cardinality(program_codes_param) = 0 then raise exception 'At least one program is required'; end if;
  if exists (select 1 from unnest(program_codes_param) p where p not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')) then
    raise exception 'Invalid program code';
  end if;

  select coalesce(sc.value::boolean, false) into enabled_value
  from public.system_config sc where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if 'SUPPLIER_OUTSOURCE' = any(program_codes_param) then
    if not coalesce(enabled_value, false) then raise exception 'Program registration is not enabled'; end if;
    if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;
  end if;

  select lower(email) into auth_email from auth.users where id = auth_user_id;
  if auth_email is distinct from lower(national_id_param || '@safetypass.com') then
    raise exception 'Authenticated identity does not match registration';
  end if;

  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  select * into linked_user from public.users where id = auth_user_id for update;
  select * into staged_user from public.users
  where id <> auth_user_id and national_id_fingerprint = national_hash
    and not coalesce(pdpa_agreed, false)
  order by created_at desc limit 1 for update;

  if linked_user.id is not null and coalesce(linked_user.pdpa_agreed, false) then
    raise exception 'Account is already registered';
  end if;
  if linked_user.id is not null and linked_user.national_id_fingerprint is distinct from national_hash then
    raise exception 'Authenticated profile does not match registration';
  end if;
  if linked_user.id is not null and not coalesce(linked_user.is_active, false) then raise exception 'Account is suspended'; end if;
  if staged_user.id is not null and not coalesce(staged_user.is_active, false) then raise exception 'Account is suspended'; end if;

  if nullif(trim(other_vendor_name_param), '') is not null then
    insert into public.vendors(name, status) values (trim(other_vendor_name_param), 'PENDING')
    returning id into final_vendor_id;
  elsif final_vendor_id is not null and not exists (
    select 1 from public.vendors where id = final_vendor_id and status = 'APPROVED'
  ) then raise exception 'Selected vendor is unavailable';
  end if;

  if linked_user.id is null then
    if staged_user.id is not null then
      update public.users set national_id_hash = null, national_id_fingerprint = null, national_id_cipher = null
      where id = staged_user.id;
    end if;
    insert into public.users(
      id, national_id, name, vendor_id, role, induction_expiry, age, nationality,
      pdpa_agreed, pdpa_agreed_at, is_active, date_of_birth, avatar_url,
      national_id_hash, national_id_fingerprint
    ) values (
      auth_user_id, national_id_param, trim(name_param), final_vendor_id,
      coalesce(staged_user.role, 'USER'), staged_user.induction_expiry, age_param,
      coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'), true, now(), true,
      staged_user.date_of_birth, staged_user.avatar_url, national_hash, national_hash
    );
  else
    update public.users set name = trim(name_param), vendor_id = final_vendor_id, age = age_param,
      nationality = coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'),
      pdpa_agreed = true, pdpa_agreed_at = now()
    where id = auth_user_id;
  end if;

  if staged_user.id is not null then
    update public.exam_history set user_id = auth_user_id where user_id = staged_user.id;
    update public.exam_logs set user_id = auth_user_id where user_id = staged_user.id;
    update public.work_permits set user_id = auth_user_id where user_id = staged_user.id;
    delete from public.users where id = staged_user.id;
  end if;

  delete from public.user_training_access
  where user_id = auth_user_id and program_code not in (select unnest(program_codes_param));
  if 'CONTRACTOR' = any(program_codes_param) then
    insert into public.user_training_access(user_id, program_code)
    values (auth_user_id, 'CONTRACTOR') on conflict (user_id, program_code) do nothing;
  end if;
  if 'SUPPLIER_OUTSOURCE' = any(program_codes_param) then
    insert into public.user_training_access(
      user_id, program_code, participant_type, work_type, access_start_date, access_end_date
    ) values (
      auth_user_id, 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
      access_start_date_param, access_end_date_param
    ) on conflict (user_id, program_code) do update
      set participant_type = excluded.participant_type, work_type = excluded.work_type,
          access_start_date = excluded.access_start_date, access_end_date = excluded.access_end_date,
          updated_at = now();
  end if;

  select jsonb_build_object(
    'id', u.id, 'national_id', national_id_param, 'name', u.name, 'vendor_id', u.vendor_id,
    'role', u.role, 'induction_expiry', u.induction_expiry, 'created_at', u.created_at,
    'age', u.age, 'nationality', u.nationality, 'pdpa_agreed', u.pdpa_agreed,
    'is_active', u.is_active, 'date_of_birth', u.date_of_birth, 'avatar_url', u.avatar_url,
    'last_login', u.last_login,
    'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
  ) into result_value
  from public.users u left join public.vendors v on v.id = u.vendor_id where u.id = auth_user_id;
  return result_value;
end;
$$;
revoke all on function public.complete_registration_v2(text, text, uuid, integer, text, text, text[], text, text, date, date) from public, anon;
grant execute on function public.complete_registration_v2(text, text, uuid, integer, text, text, text[], text, text, date, date) to authenticated, service_role;

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
  order by q.created_at;
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

  for question_record in select * from public.questions where type = exam_type_param and is_active = true loop
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
    a.passed_at, a.expires_at, h.score, h.total_questions, h.status, h.created_at,
    p.verification_token
  from public.user_training_access a
  left join lateral (
    select eh.score, eh.total_questions, eh.status, eh.created_at, eh.id
    from public.exam_history eh
    where eh.user_id = a.user_id and eh.exam_type = 'SUPPLIER_OUTSOURCE'
    order by eh.created_at desc limit 1
  ) h on true
  left join public.supplier_outsource_passes p
    on p.exam_history_id = h.id and p.status = 'ACTIVE'
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
    coalesce(u.is_active, false) and p.status = 'ACTIVE' and p.expires_at > now()
  from public.supplier_outsource_passes p
  join public.users u on u.id = p.user_id
  join public.user_training_access a on a.user_id = p.user_id and a.program_code = 'SUPPLIER_OUTSOURCE'
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
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if enabled_param then
    if participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
    if work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;
    if access_end_date_param is not null and access_start_date_param is not null
       and access_end_date_param < access_start_date_param then raise exception 'Invalid access dates'; end if;
    insert into public.user_training_access(
      user_id, program_code, participant_type, work_type, access_start_date, access_end_date
    ) values (
      user_id_param, 'SUPPLIER_OUTSOURCE', participant_type_param, work_type_param,
      access_start_date_param, access_end_date_param
    ) on conflict (user_id, program_code) do update
      set participant_type = excluded.participant_type, work_type = excluded.work_type,
          access_start_date = excluded.access_start_date, access_end_date = excluded.access_end_date,
          updated_at = now();
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
    h.created_at, a.expires_at, h.score, h.total_questions, h.status,
    a.access_start_date, a.access_end_date, p.verification_token
  from public.user_training_access a
  join public.users u on u.id = a.user_id
  left join auth.users au on au.id = u.id
  left join public.vendors v on v.id = u.vendor_id
  left join lateral (
    select eh.* from public.exam_history eh
    where eh.user_id = u.id and eh.exam_type = 'SUPPLIER_OUTSOURCE'
    order by eh.created_at desc limit 1
  ) h on true
  left join public.supplier_outsource_passes p
    on p.exam_history_id = h.id and p.status = 'ACTIVE'
  where a.program_code = 'SUPPLIER_OUTSOURCE'
  order by coalesce(h.created_at, a.created_at) desc;
end;
$$;
revoke all on function public.admin_supplier_outsource_report() from public, anon;
grant execute on function public.admin_supplier_outsource_report() to authenticated, service_role;

create or replace function public.admin_save_question(
  question_id_param uuid, exam_type_param text, pattern_param text,
  content_th_param text, content_en_param text, choices_json_param jsonb,
  correct_choice_index_param integer, image_url_param text, is_active_param boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare result_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if pattern_param not in ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'MATCHING', 'SHORT_ANSWER') then raise exception 'Invalid question pattern'; end if;
  if nullif(trim(content_th_param), '') is null or nullif(trim(content_en_param), '') is null then raise exception 'Question text is required'; end if;
  if question_id_param is null then
    insert into public.questions(type, pattern, content_th, content_en, choices_json,
      correct_choice_index, image_url, is_active)
    values (exam_type_param, pattern_param, trim(content_th_param), trim(content_en_param),
      choices_json_param, correct_choice_index_param, image_url_param, is_active_param)
    returning id into result_id;
  else
    update public.questions set type = exam_type_param, pattern = pattern_param,
      content_th = trim(content_th_param), content_en = trim(content_en_param),
      choices_json = choices_json_param, correct_choice_index = correct_choice_index_param,
      image_url = image_url_param, is_active = is_active_param
    where id = question_id_param returning id into result_id;
    if result_id is null then raise exception 'Question not found'; end if;
  end if;
  return result_id;
end;
$$;
revoke all on function public.admin_save_question(uuid, text, text, text, text, jsonb, integer, text, boolean) from public, anon;
grant execute on function public.admin_save_question(uuid, text, text, text, text, jsonb, integer, text, boolean) to authenticated, service_role;

create or replace function public.admin_delete_question(question_id_param uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  delete from public.questions where id = question_id_param;
end;
$$;
revoke all on function public.admin_delete_question(uuid) from public, anon;
grant execute on function public.admin_delete_question(uuid) to authenticated, service_role;

-- Future objects remain private by default; only explicit grants above are available.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

commit;
