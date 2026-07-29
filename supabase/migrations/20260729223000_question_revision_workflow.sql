begin;

create table if not exists public.question_revisions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  revision_no integer not null,
  snapshot jsonb not null,
  change_type text not null,
  note text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  constraint question_revisions_revision_unique unique (question_id, revision_no),
  constraint question_revisions_change_type_check check (
    change_type in ('BASELINE', 'CREATE', 'SAVE', 'PUBLISH', 'UNPUBLISH', 'RESTORE')
  )
);

create index if not exists question_revisions_question_changed_idx
  on public.question_revisions (question_id, changed_at desc);

alter table public.question_revisions enable row level security;
drop policy if exists question_revisions_admin_only on public.question_revisions;
create policy question_revisions_admin_only
  on public.question_revisions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.question_revisions from public, anon, authenticated;
grant all on table public.question_revisions to service_role;

insert into public.question_revisions (
  question_id, revision_no, snapshot, change_type, changed_by, changed_at
)
select
  q.id,
  1,
  jsonb_build_object(
    'id', q.id,
    'type', q.type,
    'pattern', q.pattern,
    'content_th', q.content_th,
    'content_en', q.content_en,
    'choices_json', q.choices_json,
    'correct_choice_index', q.correct_choice_index,
    'image_url', q.image_url,
    'is_active', coalesce(q.is_active, false)
  ),
  'BASELINE',
  null,
  coalesce(q.created_at, now())
from public.questions q
where not exists (
  select 1 from public.question_revisions qr where qr.question_id = q.id
);

create or replace function public.capture_question_revision(
  question_id_param uuid,
  change_type_param text,
  note_param text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_record public.questions%rowtype;
  next_revision integer;
  revision_id uuid;
begin
  if current_user not in ('postgres', 'service_role', 'supabase_admin') and not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if change_type_param not in ('BASELINE', 'CREATE', 'SAVE', 'PUBLISH', 'UNPUBLISH', 'RESTORE') then
    raise exception 'Invalid revision change type';
  end if;

  select * into question_record
  from public.questions
  where id = question_id_param;
  if question_record.id is null then raise exception 'Question not found'; end if;

  select coalesce(max(revision_no), 0) + 1 into next_revision
  from public.question_revisions
  where question_id = question_id_param;

  insert into public.question_revisions (
    question_id, revision_no, snapshot, change_type, note, changed_by
  ) values (
    question_record.id,
    next_revision,
    jsonb_build_object(
      'id', question_record.id,
      'type', question_record.type,
      'pattern', question_record.pattern,
      'content_th', question_record.content_th,
      'content_en', question_record.content_en,
      'choices_json', question_record.choices_json,
      'correct_choice_index', question_record.correct_choice_index,
      'image_url', question_record.image_url,
      'is_active', coalesce(question_record.is_active, false)
    ),
    change_type_param,
    nullif(trim(note_param), ''),
    auth.uid()
  ) returning id into revision_id;

  return revision_id;
end;
$$;
revoke all on function public.capture_question_revision(uuid, text, text) from public, anon, authenticated;

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
declare
  result_id uuid;
  previous_active boolean;
  revision_action text;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT', 'SUPPLIER_OUTSOURCE') then raise exception 'Invalid exam type'; end if;
  if pattern_param not in ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'MATCHING', 'SHORT_ANSWER') then raise exception 'Invalid question pattern'; end if;
  if nullif(trim(content_th_param), '') is null or nullif(trim(content_en_param), '') is null then raise exception 'Question text is required'; end if;

  if question_id_param is null then
    insert into public.questions(type, pattern, content_th, content_en, choices_json,
      correct_choice_index, image_url, is_active)
    values (exam_type_param, pattern_param, trim(content_th_param), trim(content_en_param),
      choices_json_param, correct_choice_index_param, image_url_param, coalesce(is_active_param, false))
    returning id into result_id;
    perform public.capture_question_revision(result_id, 'CREATE', 'Created question');
  else
    select coalesce(is_active, false) into previous_active
    from public.questions
    where id = question_id_param
    for update;
    if not found then raise exception 'Question not found'; end if;

    update public.questions set type = exam_type_param, pattern = pattern_param,
      content_th = trim(content_th_param), content_en = trim(content_en_param),
      choices_json = choices_json_param, correct_choice_index = correct_choice_index_param,
      image_url = image_url_param, is_active = coalesce(is_active_param, false)
    where id = question_id_param returning id into result_id;

    revision_action := case
      when previous_active = false and coalesce(is_active_param, false) = true then 'PUBLISH'
      when previous_active = true and coalesce(is_active_param, false) = false then 'UNPUBLISH'
      else 'SAVE'
    end;
    perform public.capture_question_revision(result_id, revision_action, null);
  end if;
  return result_id;
end;
$$;
revoke all on function public.admin_save_question(uuid, text, text, text, text, jsonb, integer, text, boolean) from public, anon;
grant execute on function public.admin_save_question(uuid, text, text, text, text, jsonb, integer, text, boolean) to authenticated, service_role;

create or replace function public.admin_get_question_revisions(question_id_param uuid)
returns table(
  id uuid,
  question_id uuid,
  revision_no integer,
  change_type text,
  note text,
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz,
  snapshot jsonb,
  is_current boolean
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;
  if not exists (select 1 from public.questions q where q.id = question_id_param) then
    raise exception 'Question not found';
  end if;

  return query
  select
    qr.id,
    qr.question_id,
    qr.revision_no,
    qr.change_type,
    qr.note,
    qr.changed_by,
    coalesce(u.name, 'ระบบ') as changed_by_name,
    qr.changed_at,
    qr.snapshot,
    qr.revision_no = max(qr.revision_no) over (partition by qr.question_id) as is_current
  from public.question_revisions qr
  left join public.users u on u.id = qr.changed_by
  where qr.question_id = question_id_param
  order by qr.revision_no desc;
end;
$$;
revoke all on function public.admin_get_question_revisions(uuid) from public, anon;
grant execute on function public.admin_get_question_revisions(uuid) to authenticated, service_role;

create or replace function public.admin_restore_question_revision(
  question_id_param uuid,
  revision_id_param uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision_record public.question_revisions%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin access required'; end if;

  perform 1 from public.questions where id = question_id_param for update;
  if not found then raise exception 'Question not found'; end if;

  select * into revision_record
  from public.question_revisions
  where id = revision_id_param and question_id = question_id_param;
  if revision_record.id is null then raise exception 'Revision not found'; end if;

  update public.questions
  set
    type = revision_record.snapshot->>'type',
    pattern = revision_record.snapshot->>'pattern',
    content_th = revision_record.snapshot->>'content_th',
    content_en = revision_record.snapshot->>'content_en',
    choices_json = revision_record.snapshot->'choices_json',
    correct_choice_index = coalesce((revision_record.snapshot->>'correct_choice_index')::integer, 0),
    image_url = nullif(revision_record.snapshot->>'image_url', ''),
    is_active = coalesce((revision_record.snapshot->>'is_active')::boolean, false)
  where id = question_id_param;

  perform public.capture_question_revision(
    question_id_param,
    'RESTORE',
    format('Restored revision %s', revision_record.revision_no)
  );
  return question_id_param;
end;
$$;
revoke all on function public.admin_restore_question_revision(uuid, uuid) from public, anon;
grant execute on function public.admin_restore_question_revision(uuid, uuid) to authenticated, service_role;

commit;
