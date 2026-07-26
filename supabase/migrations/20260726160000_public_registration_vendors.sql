begin;

create or replace function public.get_public_registration_vendors()
returns table(id uuid, name text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.name, v.status
  from public.vendors v
  where v.status = 'APPROVED'
  order by v.name
$$;

revoke all on function public.get_public_registration_vendors() from public;
grant execute on function public.get_public_registration_vendors() to anon, authenticated, service_role;

-- Registration reads only the minimal approved-company projection through the RPC.
-- Direct table access remains available to authenticated users under the existing RLS policies.
revoke all on table public.vendors from anon;

commit;
