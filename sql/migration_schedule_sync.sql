-- Автоимпорт графика по ссылке с Яндекс Диска.
-- Выполнить один раз в Supabase -> SQL Editor.

create table if not exists public.schedule_sync (
  id            int primary key default 1 check (id = 1),   -- всегда одна строка
  url           text,                  -- публичная ссылка на xlsx (disk.yandex.ru/i/...)
  enabled       boolean not null default false,
  last_run_at   timestamptz,
  last_status   text,                  -- ok | attention | error | skipped
  last_message  text,                  -- что произошло в последний раз
  last_alert    text,                  -- отпечаток последнего уведомления (чтобы не слать одно и то же)
  updated_at    timestamptz not null default now()
);
insert into public.schedule_sync (id) values (1) on conflict (id) do nothing;

-- доступ только у серверной функции (service role); в приложении настройки добавим отдельным шагом
alter table public.schedule_sync enable row level security;

-- Включить и задать ссылку (можно менять раз в месяц прямо здесь):
-- update public.schedule_sync set url = 'https://disk.yandex.ru/i/SBDECukQik7GdQ', enabled = true where id = 1;

-- Запуск раз в 10 минут. Подставьте свой секрет (тот же, что в SYNC_SECRET):
-- select cron.schedule('sync-schedule', '*/10 * * * *', $$
--   select net.http_post(
--     url     := 'https://gwkurcwggttztchmhvzy.functions.supabase.co/sync-schedule',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-secret','ВАШ_СЕКРЕТ'),
--     body    := '{}'::jsonb
--   );
-- $$);
