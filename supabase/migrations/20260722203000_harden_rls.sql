do $$
declare policy_record record;
begin
  for policy_record in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

create policy "users_select_own_or_admin" on public.users for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "users_insert_own" on public.users for insert to authenticated with check (id = auth.uid());
create policy "users_update_own_or_admin" on public.users for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "users_delete_admin" on public.users for delete to authenticated using (public.is_admin());

create policy "vendors_select_public" on public.vendors for select using (status = 'APPROVED' or public.is_admin());
create policy "vendors_insert_authenticated" on public.vendors for insert to authenticated with check (auth.uid() is not null);
create policy "vendors_update_admin" on public.vendors for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "vendors_delete_admin" on public.vendors for delete to authenticated using (public.is_admin());

create policy "questions_admin_only" on public.questions to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "config_select_authenticated" on public.system_config for select to authenticated using (true);
create policy "config_write_admin" on public.system_config for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "history_select_own_or_admin" on public.exam_history for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "history_write_admin" on public.exam_history for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "logs_select_own_or_admin" on public.exam_logs for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "logs_write_admin" on public.exam_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "permits_select_own_or_admin" on public.work_permits for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "permits_write_admin" on public.work_permits for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "audit_admin_only" on public.audit_logs to authenticated using (public.is_admin()) with check (public.is_admin());
