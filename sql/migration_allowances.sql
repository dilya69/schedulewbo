-- Надбавки к зарплате (тикеты, приёмка и т.п.): сумма за каждую половину месяца (1–15 и 16–конец).
-- Отдельная таблица: читать может админ и сам сотрудник (только свои), писать — только админ.
create table if not exists public.employee_allowances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null default 'Надбавка',
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index if not exists employee_allowances_emp_idx on public.employee_allowances(employee_id);
alter table public.employee_allowances enable row level security;

drop policy if exists ea_select on public.employee_allowances;
create policy ea_select on public.employee_allowances
  for select to authenticated using (public.auth_is_admin() or employee_id = public.auth_employee_id());

drop policy if exists ea_write_admin on public.employee_allowances;
create policy ea_write_admin on public.employee_allowances
  for all to authenticated using (public.auth_is_admin()) with check (public.auth_is_admin());

insert into public.employee_allowances (employee_id, kind, amount)
select id, 'Тикеты', 5000 from public.employees where full_name in ('София', 'Кирилл');
