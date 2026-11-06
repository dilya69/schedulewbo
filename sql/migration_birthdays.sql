-- Дни рождения сотрудников: только день и месяц (год не нужен).
-- Выполнять ДО выкладки нового приложения и функции send-reminders.
alter table public.employees
  add column if not exists birth_day smallint,
  add column if not exists birth_month smallint;

alter table public.employees
  drop constraint if exists employees_birthday_check;
alter table public.employees
  add constraint employees_birthday_check check (
    (birth_day is null and birth_month is null)
    or (birth_month between 1 and 12 and birth_day between 1 and 31)
  );

comment on column public.employees.birth_day is 'День рождения (число месяца), задаёт админ в карточке сотрудника';
comment on column public.employees.birth_month is 'День рождения (месяц 1-12)';
