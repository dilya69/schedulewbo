-- Несколько ссылок для автоимпорта графика (например, октябрь и ноябрь одновременно).
-- Выполнить один раз в Supabase -> SQL Editor. Старая таблица schedule_sync остаётся как есть (не удаляется),
-- но после этого функция и приложение работают только с новой таблицей schedule_sync_links.
-- Порядок: сначала этот SQL, потом новая функция, потом новый app.js/api.js.

create table if not exists public.schedule_sync_links (
  id            uuid primary key default gen_random_uuid(),
  url           text not null,
  enabled       boolean not null default true,
  last_month    text,                  -- «Октябрь 2026»: какой месяц оказался в файле при последнем запуске
  last_run_at   timestamptz,
  last_status   text,                  -- ok | attention | error | skipped
  last_message  text,
  last_alert    text,                  -- отпечаток последнего уведомления (чтобы не слать одно и то же)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists schedule_sync_links_url_uq on public.schedule_sync_links (url);

-- переносим текущую ссылку вместе со статусом последнего запуска
insert into public.schedule_sync_links (url, enabled, last_run_at, last_status, last_message, last_alert)
select s.url, s.enabled, s.last_run_at, s.last_status, s.last_message, s.last_alert
  from public.schedule_sync s
 where s.url is not null and btrim(s.url) <> ''
on conflict (url) do nothing;

alter table public.schedule_sync_links enable row level security;

-- доступ: админ читает, добавляет, включает/выключает и удаляет; статусы пишет только серверная функция
revoke all on public.schedule_sync_links from anon, authenticated;
grant select, delete on public.schedule_sync_links to authenticated;
grant insert (url, enabled) on public.schedule_sync_links to authenticated;
grant update (url, enabled) on public.schedule_sync_links to authenticated;

drop policy if exists schedule_sync_links_admin_select on public.schedule_sync_links;
create policy schedule_sync_links_admin_select on public.schedule_sync_links
  for select to authenticated using (public.auth_is_admin());

drop policy if exists schedule_sync_links_admin_insert on public.schedule_sync_links;
create policy schedule_sync_links_admin_insert on public.schedule_sync_links
  for insert to authenticated with check (public.auth_is_admin());

drop policy if exists schedule_sync_links_admin_update on public.schedule_sync_links;
create policy schedule_sync_links_admin_update on public.schedule_sync_links
  for update to authenticated using (public.auth_is_admin()) with check (public.auth_is_admin());

drop policy if exists schedule_sync_links_admin_delete on public.schedule_sync_links;
create policy schedule_sync_links_admin_delete on public.schedule_sync_links
  for delete to authenticated using (public.auth_is_admin());

-- проверка ссылки: Яндекс Диск, OneDrive или SharePoint (раньше триггер пускал только Яндекс Диск);
-- не больше 6 ссылок; при смене ссылки сбрасываем «отпечаток» уведомления
create or replace function public.schedule_sync_links_before_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.url := btrim(new.url);
  if new.url is null or new.url = '' then
    raise exception 'Вставьте ссылку на файл';
  end if;
  if new.url !~* '^https://(disk\.yandex\.[a-z]+|yadi\.sk|1drv\.ms|onedrive\.live\.com|photos\.onedrive\.com|[a-z0-9.-]+\.sharepoint\.(com|de|cn))/' then
    raise exception 'Ссылка должна вести на Яндекс Диск, OneDrive или SharePoint';
  end if;
  if tg_op = 'INSERT' then
    if (select count(*) from public.schedule_sync_links) >= 6 then
      raise exception 'Можно добавить не больше 6 ссылок: удалите старые';
    end if;
  elsif new.url is distinct from old.url then
    new.last_alert := null;
  end if;
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_schedule_sync_links_before_write on public.schedule_sync_links;
create trigger trg_schedule_sync_links_before_write
  before insert or update on public.schedule_sync_links
  for each row execute function public.schedule_sync_links_before_write();
