-- Доступ к обучающей игре (training.html).
-- Отдельная таблица, а не колонка в employees: сотрудник не может выдать доступ сам себе
-- (нет политик на запись, строки добавляются только из SQL Editor / сервисным ключом).
create table if not exists public.training_access (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.training_access enable row level security;

drop policy if exists "training_access: своя строка" on public.training_access;
create policy "training_access: своя строка" on public.training_access
  for select to authenticated
  using (employee_id = auth.uid());

grant select on public.training_access to authenticated;

-- Выдать доступ (подставьте имена; проверьте, что нашлись именно нужные люди):
-- insert into public.training_access (employee_id)
-- select id from public.employees
-- where is_active and (full_name ilike '%Диловар%' or full_name ilike '%Яна%' or full_name ilike '%Светлана%')
-- on conflict do nothing;
--
-- Забрать доступ:
-- delete from public.training_access where employee_id = '<id сотрудника>';
