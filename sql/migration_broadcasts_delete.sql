-- Разрешает админам удалять рассылки из истории (ответы удаляются каскадом).
drop policy if exists bc_delete_admin on public.broadcasts;
create policy bc_delete_admin on public.broadcasts
  for delete to authenticated using (public.auth_is_admin());
