-- Сверка смен перед зарплатой: админ рассылает сотрудникам сообщение в бота с кнопкой «Всё в порядке»,
-- в приложении видно, кто отметился. Выполнить один раз в Supabase -> SQL Editor.

create table if not exists public.schedule_checks (
  id uuid primary key default gen_random_uuid(),
  title text not null,                 -- например «Сверка смен 1–15 ноября»
  body text not null,                  -- текст сообщения
  created_at timestamptz not null default now()
);

create table if not exists public.schedule_check_replies (
  check_id uuid not null references public.schedule_checks(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  tg_chat_id bigint,
  message_id bigint,
  status text not null default 'sent' check (status in ('sent', 'ok', 'failed')),  -- ok = нажал «Всё в порядке»
  sent_at timestamptz not null default now(),
  confirmed_at timestamptz,
  primary key (check_id, employee_id)
);

alter table public.schedule_checks enable row level security;
alter table public.schedule_check_replies enable row level security;

-- читать — только админы; пишет серверная функция (service role)
drop policy if exists sc_select_admin on public.schedule_checks;
create policy sc_select_admin on public.schedule_checks
  for select to authenticated using (public.auth_is_admin());

drop policy if exists scr_select_admin on public.schedule_check_replies;
create policy scr_select_admin on public.schedule_check_replies
  for select to authenticated using (public.auth_is_admin());
