-- Рабочий чат ПВЗ: настройки команд бота, запросы помощи (/help), «нужен человек на смену».
-- Выполнить один раз в Supabase -> SQL Editor.

-- 1) Настройки по чатам (строка в help_chats создаётся командой /help_here)
alter table public.help_chats
  add column if not exists help_on boolean not null default true,        -- команда /help
  add column if not exists today_on boolean not null default true,       -- команда /today
  add column if not exists need_on boolean not null default true,        -- команда /need («нужен человек на смену»)
  add column if not exists morning_on boolean not null default false,    -- утреннее объявление «кто сегодня на смене»
  add column if not exists morning_time time not null default '08:00',   -- время объявления (по Москве)
  add column if not exists morning_last date,                            -- когда объявление уже отправлено (чтобы не дублировать)
  add column if not exists remind_min integer not null default 10;       -- через сколько минут напомнить, если никто не откликнулся на /help (0 = выкл.)

-- 2) На каких ПВЗ человека зовут по /help (NULL = на всех)
alter table public.employees add column if not exists help_pvz_ids uuid[];
comment on column public.employees.help_pvz_ids is 'Для /help: ПВЗ, где этого человека упоминают. NULL = все ПВЗ';

-- 3) Запросы помощи
create table if not exists public.help_requests (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  message_id bigint,
  is_photo boolean not null default false,
  body text not null,                         -- готовый HTML основной части сообщения
  mentions text not null default '',          -- упоминания (для напоминания)
  pvz_ids uuid[],                             -- ПВЗ, на которых ищут (если определили)
  sender_id uuid references public.employees(id) on delete set null,
  status text not null default 'open' check (status in ('open','found')),
  watchers jsonb not null default '[]'::jsonb, -- [{"id": "...", "name": "Таня"}]
  reminded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.help_requests enable row level security;
create index if not exists help_requests_open_idx on public.help_requests (status, reminded, created_at);

-- 4) «Нужен человек на смену»
create table if not exists public.need_requests (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  message_id bigint,
  pvz_id uuid not null references public.pvz(id) on delete cascade,
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  created_by uuid references public.employees(id) on delete set null,
  status text not null default 'open' check (status in ('open','taken','cancelled')),
  taken_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.need_requests enable row level security;

-- 5) Ключ для запуска по расписанию лежит в базе (наружу не выдаётся)
create table if not exists public.bot_secrets (key text primary key, value text not null);
alter table public.bot_secrets enable row level security;
insert into public.bot_secrets (key, value)
values ('tick', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- 6) Запуск раз в 5 минут (утреннее объявление и напоминания по /help)
-- select cron.schedule('chat-tick', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://gwkurcwggttztchmhvzy.supabase.co/functions/v1/bot-webhook',
--     headers := jsonb_build_object('Content-Type','application/json','x-tick-secret',(select value from public.bot_secrets where key='tick')),
--     body    := '{"tick":true}'::jsonb
--   );
-- $$);
