create or replace function public.submit_safety_exam(
  exam_type_param text,
  answers_param jsonb,
  permit_no_param text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  question_record record;
  choice_record record;
  answer_value jsonb;
  choice_value jsonb;
  score_value integer := 0;
  total_value integer := 0;
  threshold_value numeric := 80;
  passed_value boolean;
  result_map jsonb := '{}'::jsonb;
  correct_value boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if exam_type_param not in ('INDUCTION', 'WORK_PERMIT') then raise exception 'Invalid exam type'; end if;
  if exam_type_param = 'WORK_PERMIT' and not exists (
    select 1 from public.users where id = auth.uid() and induction_expiry > now()
  ) then raise exception 'Valid induction is required'; end if;
  if exam_type_param = 'WORK_PERMIT' and (permit_no_param is null or permit_no_param !~ '^[0-9]{10}$') then
    raise exception 'Invalid permit number';
  end if;
  select coalesce(value::numeric, 80) into threshold_value
  from public.system_config where key = case when exam_type_param = 'INDUCTION' then 'PASSING_SCORE_INDUCTION' else 'PASSING_SCORE_WORK_PERMIT' end;
  for question_record in select * from public.questions where type = exam_type_param and is_active = true loop
    total_value := total_value + 1;
    answer_value := answers_param -> question_record.id::text;
    correct_value := false;
    if answer_value is not null then
      if question_record.pattern = 'SHORT_ANSWER' then
        correct_value := lower(trim(answer_value #>> '{}')) = lower(trim(question_record.choices_json -> 0 ->> 'correct_answer'));
      elsif question_record.pattern = 'MATCHING' then
        correct_value := true;
        for choice_record in select value, ordinality from jsonb_array_elements(question_record.choices_json) with ordinality as x(value, ordinality) loop
          if coalesce((answer_value ->> (choice_record.ordinality - 1)::text)::integer, -1) <> choice_record.ordinality - 1 then correct_value := false; end if;
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
  values(auth.uid(), exam_type_param, score_value, total_value, case when passed_value then 'PASSED' else 'FAILED' end);
  insert into public.exam_logs(user_id, exam_type, score, passed) values(auth.uid(), exam_type_param, score_value, passed_value);
  if passed_value and exam_type_param = 'INDUCTION' then
    update public.users set induction_expiry = date_trunc('day', now()) + interval '1 year 1 day - 1 millisecond' where id = auth.uid();
  elsif passed_value and exam_type_param = 'WORK_PERMIT' then
    update public.work_permits set status = 'EXPIRED' where user_id = auth.uid() and status = 'ACTIVE';
    insert into public.work_permits(user_id, permit_no, expire_date, status)
    values(auth.uid(), permit_no_param, date_trunc('day', now()) + interval '5 days - 1 millisecond', 'ACTIVE');
  end if;
  return jsonb_build_object('score', score_value, 'passed', passed_value, 'perQuestion', result_map);
end;
$$;
revoke all on function public.submit_safety_exam(text, jsonb, text) from public;
grant execute on function public.submit_safety_exam(text, jsonb, text) to authenticated;
