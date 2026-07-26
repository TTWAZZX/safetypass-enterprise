begin;

-- New objects must be explicitly granted. Existing grants are reviewed below.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

alter table public.users add column if not exists national_id_fingerprint text;

-- Build a non-unique lookup fingerprint without decrypting or rewriting legacy data.
-- Rows whose legacy ciphertext cannot be verified remain untouched for a separate recovery round.
update public.users
set national_id_fingerprint = case
  when national_id_hash ~ '^[0-9a-f]{64}$' then national_id_hash
  when national_id ~ '^[0-9]{13}$' then encode(extensions.digest(national_id, 'sha256'), 'hex')
  else null
end
where national_id_fingerprint is null;

-- Restrict the legacy helpers while retaining compatibility for records that already use them.
alter function public.encrypt_user_data() set search_path = public, extensions;
alter function public.get_my_decrypted_id() set search_path = public, extensions;
revoke all on function public.encrypt_user_data() from public, anon, authenticated;
revoke all on function public.get_my_decrypted_id() from public, anon;
grant execute on function public.get_my_decrypted_id() to authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'ADMIN'
  )
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Public pre-check exposes only account state, never profile or identity details.
drop function if exists public.check_user_exists(text);
create function public.check_user_exists(search_id text)
returns table(user_exists boolean, requires_registration boolean, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    true,
    not coalesce(u.pdpa_agreed, false),
    coalesce(u.is_active, false)
  from public.users u
  where search_id ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(search_id, 'sha256'), 'hex')
  order by coalesce(u.pdpa_agreed, false) desc, coalesce(u.is_active, false) desc, u.created_at desc
  limit 1
$$;
revoke all on function public.check_user_exists(text) from public;
grant execute on function public.check_user_exists(text) to anon, authenticated, service_role;

-- The legacy exam RPC is superseded by submit_safety_exam and must not remain callable.
revoke all on function public.submit_exam_attempt(text, jsonb, text) from public, anon, authenticated;
drop function if exists public.submit_exam_attempt(text, jsonb, text);

create or replace function public.get_exam_questions(exam_type_param text)
returns table (
  id uuid,
  type text,
  pattern text,
  content_th text,
  content_en text,
  choices_json jsonb,
  image_url text,
  is_active boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    q.id,
    q.type,
    q.pattern,
    q.content_th,
    q.content_en,
    case
      when jsonb_typeof(q.choices_json) = 'array' then
        coalesce((
          select jsonb_agg(choice - 'is_correct' - 'correct_answer')
          from jsonb_array_elements(q.choices_json) as choice
        ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    q.image_url,
    q.is_active
  from public.questions q
  where q.type = exam_type_param and q.is_active = true
  order by q.created_at
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
  passed_value boolean;
  result_map jsonb := '{}'::jsonb;
  correct_value boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (
    select 1 from public.users where id = auth.uid() and coalesce(is_active, false)
  ) then raise exception 'Account is unavailable'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT') then raise exception 'Invalid exam type'; end if;
  if exists (
    select 1 from public.exam_history
    where user_id = auth.uid()
      and exam_type = exam_type_param
      and created_at >= now() - interval '60 seconds'
  ) then raise exception 'Please wait before submitting another exam'; end if;
  if exam_type_param = 'WORK_PERMIT' and not exists (
    select 1 from public.users where id = auth.uid() and induction_expiry > now()
  ) then raise exception 'Valid induction is required'; end if;
  if exam_type_param = 'WORK_PERMIT' and (permit_no_param is null or permit_no_param !~ '^[0-9]{10}$') then
    raise exception 'Invalid permit number';
  end if;

  select coalesce(value::numeric, 80) into threshold_value
  from public.system_config
  where key = case
    when exam_type_param = 'INDUCTION' then 'PASSING_SCORE_INDUCTION'
    else 'PASSING_SCORE_WORK_PERMIT'
  end;

  for question_record in
    select * from public.questions where type = exam_type_param and is_active = true
  loop
    total_value := total_value + 1;
    answer_value := answers_param -> question_record.id::text;
    correct_value := false;
    if answer_value is not null then
      if question_record.pattern = 'SHORT_ANSWER' then
        correct_value := lower(trim(answer_value #>> '{}')) =
          lower(trim(question_record.choices_json -> 0 ->> 'correct_answer'));
      elsif question_record.pattern = 'MATCHING' then
        correct_value := true;
        for choice_record in
          select value, ordinality
          from jsonb_array_elements(question_record.choices_json) with ordinality as x(value, ordinality)
        loop
          if coalesce((answer_value ->> (choice_record.ordinality - 1)::text)::integer, -1)
             <> choice_record.ordinality - 1 then
            correct_value := false;
          end if;
        end loop;
      else
        correct_value := coalesce((answer_value #>> '{}')::integer, -1) =
          question_record.correct_choice_index;
      end if;
    end if;
    if correct_value then score_value := score_value + 1; end if;
    result_map := result_map || jsonb_build_object(question_record.id::text, correct_value);
  end loop;

  if total_value = 0 then raise exception 'No active questions'; end if;
  passed_value := score_value::numeric * 100 / total_value >= threshold_value;

  insert into public.exam_history(user_id, exam_type, score, total_questions, status)
  values (
    auth.uid(), exam_type_param, score_value, total_value,
    case when passed_value then 'PASSED' else 'FAILED' end
  );
  insert into public.exam_logs(user_id, exam_type, score, passed)
  values (auth.uid(), exam_type_param, score_value, passed_value);

  if passed_value and exam_type_param = 'INDUCTION' then
    update public.users
    set induction_expiry = date_trunc('day', now()) + interval '1 year 1 day - 1 millisecond'
    where id = auth.uid();
  elsif passed_value and exam_type_param = 'WORK_PERMIT' then
    update public.work_permits
    set status = 'EXPIRED'
    where user_id = auth.uid() and status = 'ACTIVE';
    insert into public.work_permits(user_id, permit_no, expire_date, status)
    values (
      auth.uid(), permit_no_param,
      date_trunc('day', now()) + interval '5 days - 1 millisecond',
      'ACTIVE'
    );
  end if;

  return jsonb_build_object(
    'score', score_value,
    'passed', passed_value,
    'perQuestion', result_map
  );
end;
$$;

revoke all on function public.get_exam_questions(text) from public, anon;
grant execute on function public.get_exam_questions(text) to authenticated, service_role;
revoke all on function public.submit_safety_exam(text, jsonb, text) from public, anon;
grant execute on function public.submit_safety_exam(text, jsonb, text) to authenticated, service_role;
revoke all on function public.verify_induction_pass(text) from public;
grant execute on function public.verify_induction_pass(text) to anon, authenticated, service_role;
revoke all on function public.verify_safety_pass(text) from public;
grant execute on function public.verify_safety_pass(text) to anon, authenticated, service_role;

create or replace function public.verify_induction_pass(national_id_param text)
returns table(
  name text,
  vendor_name text,
  masked_national_id text,
  induction_expiry timestamptz,
  is_active boolean
)
language sql
security definer
set search_path = ''
as $$
  select
    u.name,
    v.name,
    case when national_id_param ~ '^[0-9]{13}$' then
      substring(national_id_param from 1 for 1) || '-' ||
      substring(national_id_param from 2 for 4) || '-XXXXX-' ||
      substring(national_id_param from 11 for 2) || '-' ||
      substring(national_id_param from 13 for 1)
    else null end,
    u.induction_expiry,
    coalesce(u.is_active, false)
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where national_id_param ~ '^[0-9]{13}$'
    and u.national_id_fingerprint = encode(extensions.digest(national_id_param, 'sha256'), 'hex')
  order by
    (coalesce(u.is_active, false) and u.induction_expiry > now()) desc nulls last,
    u.induction_expiry desc nulls last,
    u.created_at desc
  limit 1
$$;
revoke all on function public.verify_induction_pass(text) from public;
grant execute on function public.verify_induction_pass(text) to anon, authenticated, service_role;

create or replace function public.verify_safety_pass(permit_no_param text)
returns table(name text, vendor_name text, permit_no text, expire_date timestamptz, is_active boolean)
language sql
security definer
set search_path = ''
as $$
  select u.name, v.name, p.permit_no, p.expire_date,
    coalesce(u.is_active, false) and p.status = 'ACTIVE' and p.expire_date > now()
  from public.work_permits p
  join public.users u on u.id = p.user_id
  left join public.vendors v on v.id = u.vendor_id
  where p.permit_no = permit_no_param
  order by p.created_at desc
  limit 1
$$;
revoke all on function public.verify_safety_pass(text) from public;
grant execute on function public.verify_safety_pass(text) to anon, authenticated, service_role;

-- Guard sensitive user columns even when a future policy is accidentally too broad.
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
     ) then
    raise exception 'Protected user fields must be changed through an authorized RPC';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_user_security_fields() from public, anon, authenticated;

drop trigger if exists trg_protect_user_security_fields on public.users;
create trigger trg_protect_user_security_fields
before update on public.users
for each row execute function public.protect_user_security_fields();

create index if not exists idx_users_national_id_fingerprint
on public.users(national_id_fingerprint);

-- Additive training entitlement foundation.
create table public.user_training_access (
  user_id uuid not null references public.users(id) on delete cascade,
  program_code text not null,
  participant_type text,
  work_type text,
  passed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, program_code),
  constraint user_training_access_program_check
    check (program_code in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')),
  constraint user_training_access_participant_check
    check (participant_type is null or participant_type in ('supplier', 'outsource')),
  constraint user_training_access_work_type_check
    check (work_type is null or work_type in ('Driver', 'Passenger', 'Trainee')),
  constraint user_training_access_program_fields_check
    check (
      program_code = 'SUPPLIER_OUTSOURCE'
      or (participant_type is null and work_type is null and passed_at is null and expires_at is null)
    ),
  constraint user_training_access_expiry_check
    check (expires_at is null or passed_at is null or expires_at > passed_at)
);

create index user_training_access_program_idx on public.user_training_access(program_code);
create index user_training_access_expiry_idx on public.user_training_access(expires_at)
where expires_at is not null;

alter table public.user_training_access enable row level security;
create policy training_access_select_own_or_admin
on public.user_training_access for select to authenticated
using (user_id = auth.uid() or public.is_admin());
create policy training_access_admin_insert
on public.user_training_access for insert to authenticated
with check (public.is_admin());
create policy training_access_admin_update
on public.user_training_access for update to authenticated
using (public.is_admin()) with check (public.is_admin());
create policy training_access_admin_delete
on public.user_training_access for delete to authenticated
using (public.is_admin());

revoke all on table public.user_training_access from public, anon, authenticated;
grant select on table public.user_training_access to authenticated;

insert into public.system_config(key, value)
values ('SUPPLIER_OUTSOURCE_ENABLED', 'false')
on conflict (key) do nothing;

do $$
declare
  users_before bigint;
  contractor_rows bigint;
begin
  select count(*) into users_before from public.users;

  insert into public.user_training_access(user_id, program_code)
  select id, 'CONTRACTOR' from public.users
  on conflict (user_id, program_code) do nothing;

  select count(*) into contractor_rows
  from public.user_training_access
  where program_code = 'CONTRACTOR';

  if contractor_rows <> users_before then
    raise exception 'Contractor entitlement backfill integrity check failed';
  end if;
end;
$$;

create or replace function public.add_my_training_access(
  program_codes text[],
  participant_type_param text default null,
  work_type_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  program_value text;
  enabled_value boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select coalesce(sc.value::boolean, false) into enabled_value
  from public.system_config sc
  where sc.key = 'SUPPLIER_OUTSOURCE_ENABLED';
  if not coalesce(enabled_value, false) then raise exception 'Program registration is not enabled'; end if;

  if program_codes is null or cardinality(program_codes) = 0 then
    raise exception 'At least one program is required';
  end if;
  if exists (select 1 from unnest(program_codes) p where p not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE')) then
    raise exception 'Invalid program code';
  end if;
  if participant_type_param is not null and participant_type_param not in ('supplier', 'outsource') then
    raise exception 'Invalid participant type';
  end if;
  if work_type_param is not null and work_type_param not in ('Driver', 'Passenger', 'Trainee') then
    raise exception 'Invalid work type';
  end if;

  foreach program_value in array program_codes loop
    insert into public.user_training_access(user_id, program_code, participant_type, work_type)
    values (
      auth.uid(),
      program_value,
      case when program_value = 'SUPPLIER_OUTSOURCE' then participant_type_param else null end,
      case when program_value = 'SUPPLIER_OUTSOURCE' then work_type_param else null end
    )
    on conflict (user_id, program_code) do update
    set participant_type = excluded.participant_type,
        work_type = excluded.work_type,
        updated_at = now();
  end loop;
end;
$$;
revoke all on function public.add_my_training_access(text[], text, text) from public, anon;
grant execute on function public.add_my_training_access(text[], text, text) to authenticated, service_role;

create or replace function public.admin_set_training_access(
  user_id_param uuid,
  program_code_param text,
  enabled_param boolean,
  participant_type_param text default null,
  work_type_param text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if program_code_param not in ('CONTRACTOR', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid program code'; end if;
  if participant_type_param is not null and participant_type_param not in ('supplier', 'outsource') then raise exception 'Invalid participant type'; end if;
  if work_type_param is not null and work_type_param not in ('Driver', 'Passenger', 'Trainee') then raise exception 'Invalid work type'; end if;

  if enabled_param then
    insert into public.user_training_access(user_id, program_code, participant_type, work_type)
    values (
      user_id_param,
      program_code_param,
      case when program_code_param = 'SUPPLIER_OUTSOURCE' then participant_type_param else null end,
      case when program_code_param = 'SUPPLIER_OUTSOURCE' then work_type_param else null end
    )
    on conflict (user_id, program_code) do update
    set participant_type = excluded.participant_type,
        work_type = excluded.work_type,
        updated_at = now();
  else
    delete from public.user_training_access
    where user_id = user_id_param and program_code = program_code_param;
  end if;
end;
$$;
revoke all on function public.admin_set_training_access(uuid, text, boolean, text, text) from public, anon;
grant execute on function public.admin_set_training_access(uuid, text, boolean, text, text) to authenticated, service_role;

-- Transactional registration keeps the existing national-ID/PIN authentication flow.
create or replace function public.complete_registration(
  national_id_param text,
  name_param text,
  vendor_id_param uuid default null,
  age_param integer default null,
  nationality_param text default 'ไทย (Thai)',
  other_vendor_name_param text default null
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
begin
  if auth_user_id is null then raise exception 'Not authenticated'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if nullif(trim(name_param), '') is null then raise exception 'Name is required'; end if;
  if age_param is not null and (age_param < 0 or age_param > 120) then raise exception 'Invalid age'; end if;

  select lower(email) into auth_email from auth.users where id = auth_user_id;
  if auth_email is distinct from lower(national_id_param || '@safetypass.com') then
    raise exception 'Authenticated identity does not match registration';
  end if;

  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');
  select * into linked_user from public.users where id = auth_user_id for update;
  select * into staged_user
  from public.users
  where id <> auth_user_id
    and national_id_fingerprint = national_hash
    and not coalesce(pdpa_agreed, false)
  order by created_at desc
  limit 1 for update;

  if linked_user.id is not null and coalesce(linked_user.pdpa_agreed, false) then
    raise exception 'Account is already registered';
  end if;
  if linked_user.id is not null and linked_user.national_id_fingerprint is distinct from national_hash then
    raise exception 'Authenticated profile does not match registration';
  end if;
  if linked_user.id is not null and not coalesce(linked_user.is_active, false) then
    raise exception 'Account is suspended';
  end if;
  if staged_user.id is not null and not coalesce(staged_user.is_active, false) then
    raise exception 'Account is suspended';
  end if;

  if nullif(trim(other_vendor_name_param), '') is not null then
    insert into public.vendors(name, status)
    values (trim(other_vendor_name_param), 'PENDING')
    returning id into final_vendor_id;
  elsif final_vendor_id is not null and not exists (
    select 1 from public.vendors where id = final_vendor_id and status = 'APPROVED'
  ) then
    raise exception 'Selected vendor is unavailable';
  end if;

  if linked_user.id is null then
    if staged_user.id is not null then
      update public.users
      set national_id_hash = null, national_id_fingerprint = null, national_id_cipher = null
      where id = staged_user.id;
    end if;

    insert into public.users(
      id, national_id, name, vendor_id, role, induction_expiry, age, nationality,
      pdpa_agreed, pdpa_agreed_at, is_active, date_of_birth, avatar_url,
      national_id_hash, national_id_fingerprint
    ) values (
      auth_user_id,
      national_id_param,
      trim(name_param),
      final_vendor_id,
      coalesce(staged_user.role, 'USER'),
      staged_user.induction_expiry,
      age_param,
      coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'),
      true,
      now(),
      true,
      staged_user.date_of_birth,
      staged_user.avatar_url,
      national_hash,
      national_hash
    );
  else
    update public.users
    set name = trim(name_param),
        vendor_id = final_vendor_id,
        age = age_param,
        nationality = coalesce(nullif(trim(nationality_param), ''), 'ไทย (Thai)'),
        pdpa_agreed = true,
        pdpa_agreed_at = now()
    where id = auth_user_id;
  end if;

  if staged_user.id is not null then
    update public.exam_history set user_id = auth_user_id where user_id = staged_user.id;
    update public.exam_logs set user_id = auth_user_id where user_id = staged_user.id;
    update public.work_permits set user_id = auth_user_id where user_id = staged_user.id;
    delete from public.users where id = staged_user.id;
  end if;

  insert into public.user_training_access(user_id, program_code)
  values (auth_user_id, 'CONTRACTOR')
  on conflict (user_id, program_code) do nothing;

  select jsonb_build_object(
    'id', u.id,
    'national_id', national_id_param,
    'name', u.name,
    'vendor_id', u.vendor_id,
    'role', u.role,
    'induction_expiry', u.induction_expiry,
    'created_at', u.created_at,
    'age', u.age,
    'nationality', u.nationality,
    'pdpa_agreed', u.pdpa_agreed,
    'is_active', u.is_active,
    'date_of_birth', u.date_of_birth,
    'avatar_url', u.avatar_url,
    'last_login', u.last_login,
    'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
  ) into result_value
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  where u.id = auth_user_id;

  return result_value;
end;
$$;
revoke all on function public.complete_registration(text, text, uuid, integer, text, text) from public, anon;
grant execute on function public.complete_registration(text, text, uuid, integer, text, text) to authenticated, service_role;

create or replace function public.reset_my_induction()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  update public.users set induction_expiry = null where id = auth.uid();
end;
$$;
revoke all on function public.reset_my_induction() from public, anon;
grant execute on function public.reset_my_induction() to authenticated, service_role;

create or replace function public.admin_update_user_profile(
  user_id_param uuid,
  name_param text,
  age_param integer,
  nationality_param text,
  vendor_id_param uuid,
  induction_expiry_param timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.users
  set name = trim(name_param), age = age_param, nationality = nationality_param,
      vendor_id = vendor_id_param, induction_expiry = induction_expiry_param
  where id = user_id_param;
  if not found then raise exception 'User not found'; end if;
end;
$$;
revoke all on function public.admin_update_user_profile(uuid, text, integer, text, uuid, timestamptz) from public, anon;
grant execute on function public.admin_update_user_profile(uuid, text, integer, text, uuid, timestamptz) to authenticated, service_role;

create or replace function public.admin_set_user_active(user_id_param uuid, is_active_param boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.users set is_active = is_active_param where id = user_id_param;
  if not found then raise exception 'User not found'; end if;
end;
$$;
revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated, service_role;

create or replace function public.admin_reset_induction(user_ids_param uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  update public.users set induction_expiry = null where id = any(user_ids_param);
  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$$;
revoke all on function public.admin_reset_induction(uuid[]) from public, anon;
grant execute on function public.admin_reset_induction(uuid[]) to authenticated, service_role;

create or replace function public.admin_upsert_staged_user(
  national_id_param text,
  name_param text,
  vendor_id_param uuid default null,
  role_param text default 'USER',
  age_param integer default null,
  nationality_param text default 'ไทย (Thai)',
  induction_expiry_param timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  national_hash text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if national_id_param !~ '^[0-9]{13}$' then raise exception 'Invalid national ID'; end if;
  if role_param not in ('ADMIN', 'USER') then raise exception 'Invalid role'; end if;
  national_hash := encode(extensions.digest(national_id_param, 'sha256'), 'hex');

  select id into target_id
  from public.users
  where national_id_fingerprint = national_hash
  order by coalesce(pdpa_agreed, false) desc, created_at desc
  limit 1 for update;
  if target_id is null then
    target_id := gen_random_uuid();
    insert into public.users(
      id, national_id, name, vendor_id, role, age, nationality,
      induction_expiry, pdpa_agreed, is_active, national_id_hash, national_id_fingerprint
    ) values (
      target_id, national_id_param, trim(name_param), vendor_id_param, role_param,
      age_param, nationality_param, induction_expiry_param, false, true, national_hash, national_hash
    );
  else
    update public.users
    set name = trim(name_param), vendor_id = vendor_id_param, role = role_param,
        age = age_param, nationality = nationality_param,
        induction_expiry = induction_expiry_param
    where id = target_id;
  end if;

  insert into public.user_training_access(user_id, program_code)
  values (target_id, 'CONTRACTOR')
  on conflict (user_id, program_code) do nothing;
  return target_id;
end;
$$;
revoke all on function public.admin_upsert_staged_user(text, text, uuid, text, integer, text, timestamptz) from public, anon;
grant execute on function public.admin_upsert_staged_user(text, text, uuid, text, integer, text, timestamptz) to authenticated, service_role;

create or replace function public.admin_list_users()
returns table(
  id uuid,
  national_id text,
  name text,
  vendor_id uuid,
  role text,
  induction_expiry timestamptz,
  created_at timestamptz,
  age integer,
  nationality text,
  pdpa_agreed boolean,
  is_active boolean,
  date_of_birth date,
  avatar_url text,
  last_login timestamptz,
  vendors jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    u.id,
    u.national_id,
    u.name,
    u.vendor_id,
    u.role,
    u.induction_expiry,
    u.created_at,
    u.age,
    u.nationality,
    u.pdpa_agreed,
    u.is_active,
    u.date_of_birth,
    u.avatar_url,
    u.last_login,
    case when v.id is null then null else jsonb_build_object('name', v.name) end
  from public.users u
  left join public.vendors v on v.id = u.vendor_id
  order by u.created_at desc;
end;
$$;
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated, service_role;

create or replace function public.admin_get_exam_history()
returns table(
  id uuid,
  user_id uuid,
  exam_type text,
  score integer,
  total_questions integer,
  status text,
  created_at timestamptz,
  users jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  return query
  select
    h.id, h.user_id, h.exam_type, h.score, h.total_questions, h.status, h.created_at,
    case when u.id is null then null else jsonb_build_object(
      'name', u.name,
      'national_id', u.national_id,
      'age', u.age,
      'nationality', u.nationality,
      'vendors', case when v.id is null then null else jsonb_build_object('name', v.name) end
    ) end
  from public.exam_history h
  left join public.users u on u.id = h.user_id
  left join public.vendors v on v.id = u.vendor_id
  order by h.created_at desc;
end;
$$;
revoke all on function public.admin_get_exam_history() from public, anon;
grant execute on function public.admin_get_exam_history() to authenticated, service_role;

-- Anonymous roles must access private data only through the two public verification RPCs
-- and the minimal registration pre-check.
revoke all on table public.users from anon;
revoke all on table public.questions from anon;
revoke all on table public.exam_history from anon;
revoke all on table public.exam_logs from anon;
revoke all on table public.work_permits from anon;
revoke all on table public.audit_logs from anon;
revoke all on table public.system_config from anon;
revoke all on table public.vendors from anon;
grant select on table public.vendors to anon;

commit;
