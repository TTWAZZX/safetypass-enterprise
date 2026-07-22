-- Safe read APIs used before tightening row-level security.
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
set search_path = public
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
  where q.type = exam_type_param
    and q.is_active = true
  order by q.created_at;
$$;

revoke all on function public.get_exam_questions(text) from public;
grant execute on function public.get_exam_questions(text) to authenticated;

create or replace function public.verify_safety_pass(permit_no_param text)
returns table (
  name text,
  vendor_name text,
  permit_no text,
  expire_date timestamptz,
  is_active boolean
)
language sql
security definer
set search_path = public
as $$
  select u.name, v.name, p.permit_no, p.expire_date,
    coalesce(u.is_active, false) and p.status = 'ACTIVE' and p.expire_date > now()
  from public.work_permits p
  join public.users u on u.id = p.user_id
  left join public.vendors v on v.id = u.vendor_id
  where p.permit_no = permit_no_param
  order by p.created_at desc
  limit 1;
$$;

revoke all on function public.verify_safety_pass(text) from public;
grant execute on function public.verify_safety_pass(text) to anon, authenticated;
