-- Админка для компьютера: раздел «Чат бота» (настройки рабочего чата) читает и правит help_chats.
-- Выполнить один раз в Supabase -> SQL Editor.
drop policy if exists hc_select_admin on public.help_chats;
create policy hc_select_admin on public.help_chats
  for select to authenticated using (public.auth_is_admin());

drop policy if exists hc_update_admin on public.help_chats;
create policy hc_update_admin on public.help_chats
  for update to authenticated using (public.auth_is_admin()) with check (public.auth_is_admin());
