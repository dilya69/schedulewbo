-- Рассылка из бота: админ выбирает получателей, пишет текст, бот шлёт с подписью отправителя
-- и кнопкой «Принял(а)». Выполнить один раз в Supabase -> SQL Editor.

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references public.employees(id) on delete set null,
  author_name text not null,           -- подпись: имя отправителя на момент рассылки
  body text not null,                  -- текст без подписи
  created_at timestamptz not null default now()
);

create table if not exists public.broadcast_replies (
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  tg_chat_id bigint,
  message_id bigint,
  status text not null default 'sent' check (status in ('sent', 'ok', 'failed')),  -- ok = нажал «Принял(а)»
  sent_at timestamptz not null default now(),
  confirmed_at timestamptz,
  primary key (broadcast_id, employee_id)
);

-- черновик рассылки в чате с ботом (кому, текст, на каком шаге); один на админа
create table if not exists public.bot_drafts (
  tg_id bigint primary key,
  step text not null default 'pick',   -- pick | text | preview
  employee_ids uuid[] not null default '{}',
  body text,
  updated_at timestamptz not null default now()
);

alter table public.broadcasts enable row level security;
alter table public.broadcast_replies enable row level security;
alter table public.bot_drafts enable row level security;  -- без политик: доступ только у серверной функции

drop policy if exists bc_select_admin on public.broadcasts;
create policy bc_select_admin on public.broadcasts
  for select to authenticated using (public.auth_is_admin());

drop policy if exists bcr_select_admin on public.broadcast_replies;
create policy bcr_select_admin on public.broadcast_replies
  for select to authenticated using (public.auth_is_admin());
