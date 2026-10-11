-- Управление автоимпортом из приложения: админ меняет ссылку и включает/выключает автоимпорт.
-- Выполнить один раз в Supabase -> SQL Editor (после migration_schedule_sync.sql).

-- 1) Доступ: читать и менять url/enabled может только админ; остальные колонки пишет только сервер.
revoke all on public.schedule_sync from anon, authenticated;
grant select on public.schedule_sync to authenticated;
grant update (url, enabled) on public.schedule_sync to authenticated;

drop policy if exists schedule_sync_admin_select on public.schedule_sync;
create policy schedule_sync_admin_select on public.schedule_sync
  for select to authenticated using (public.auth_is_admin());

drop policy if exists schedule_sync_admin_update on public.schedule_sync;
create policy schedule_sync_admin_update on public.schedule_sync
  for update to authenticated using (public.auth_is_admin()) with check (public.auth_is_admin());

-- 2) Ссылка должна вести на Яндекс Диск; при смене ссылки сбрасываем «отпечаток» прошлого уведомления,
--    чтобы о проблемах нового файла админам написали заново.
create or replace function public.schedule_sync_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.url is distinct from old.url then
    new.url := nullif(btrim(new.url), '');
    if new.url is not null and new.url !~* '^https://(disk\.yandex\.(ru|com)|yadi\.sk)/' then
      raise exception 'Ссылка должна вести на Яндекс Диск (disk.yandex.ru/... или yadi.sk/...)';
    end if;
    new.last_alert := null;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_schedule_sync_before_update on public.schedule_sync;
create trigger trg_schedule_sync_before_update before update on public.schedule_sync
  for each row execute function public.schedule_sync_before_update();
