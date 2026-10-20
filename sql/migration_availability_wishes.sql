-- Пожелания сотрудников по графику на месяц.
-- Админ включает приём пожеланий тумблером в блоке под календарём (по каждому месяцу отдельно).
-- Сотрудник, пока приём включён, отмечает дни: весь день / с часа / другие часы / нужен выходной + комментарий.
-- Админ видит список и удаляет записи после составления графика.

-- 1) Включён ли приём пожеланий на месяц (month = первое число месяца)
create table if not exists public.wish_months (
  month date primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

-- 2) Пожелания: одна запись на сотрудника на месяц.
-- days: {"5":{"t":"full"}, "6":{"t":"from","from":"17:00"}, "7":{"t":"range","from":"12:00","to":"18:00"}, "8":{"t":"off"}}
create table if not exists public.availability_wishes (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  month date not null,
  days jsonb not null default '{}'::jsonb,
  comment text,
  updated_at timestamptz not null default now(),
  unique (employee_id, month)
);

create index if not exists availability_wishes_month_idx on public.availability_wishes (month);

alter table public.wish_months enable row level security;
alter table public.availability_wishes enable row level security;

-- wish_months: читают все вошедшие, меняет только админ
drop policy if exists wish_months_select on public.wish_months;
create policy wish_months_select on public.wish_months
  for select to authenticated using (true);

drop policy if exists wish_months_admin_write on public.wish_months;
create policy wish_months_admin_write on public.wish_months
  for all to authenticated
  using (public.auth_is_admin())
  with check (public.auth_is_admin());

-- availability_wishes: сотрудник видит и правит только свои, и только пока приём включён;
-- админ видит все и может удалять
drop policy if exists wishes_select on public.availability_wishes;
create policy wishes_select on public.availability_wishes
  for select to authenticated
  using (employee_id = public.auth_employee_id() or public.auth_is_admin());

drop policy if exists wishes_insert_own on public.availability_wishes;
create policy wishes_insert_own on public.availability_wishes
  for insert to authenticated
  with check (
    employee_id = public.auth_employee_id()
    and exists (select 1 from public.wish_months m where m.month = availability_wishes.month and m.enabled)
  );

drop policy if exists wishes_update_own on public.availability_wishes;
create policy wishes_update_own on public.availability_wishes
  for update to authenticated
  using (
    employee_id = public.auth_employee_id()
    and exists (select 1 from public.wish_months m where m.month = availability_wishes.month and m.enabled)
  )
  with check (
    employee_id = public.auth_employee_id()
    and exists (select 1 from public.wish_months m where m.month = availability_wishes.month and m.enabled)
  );

drop policy if exists wishes_delete_admin on public.availability_wishes;
create policy wishes_delete_admin on public.availability_wishes
  for delete to authenticated
  using (public.auth_is_admin());
