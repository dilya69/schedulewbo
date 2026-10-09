-- ПРЕДЛОЖЕНИЕ по безопасности (по результатам проверки 2026-10-09).
-- Автоматически НЕ применялось. Выполнить в Supabase -> SQL Editor.

-- 1) Сотрудник (не админ) мог через API изменить в своей строке employees любые поля,
--    в том числе is_admin, ставки и зарплату: политика employees_update_self_or_admin
--    не ограничивает колонки. Приложение у обычного сотрудника меняет только
--    avatar_emoji и avatar_frame, поэтому остальное закрываем триггером.
--    Админ и серверные функции (service role) не затронуты.
create or replace function public.employees_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' and not public.auth_is_admin() then
    if (new.id, new.tg_id, new.tg_username, new.full_name, new."position", new.is_admin, new.is_active,
        new.default_rate, new.rating, new.pay_type, new.fixed_salary, new.sheet_alias, new.created_at)
       is distinct from
       (old.id, old.tg_id, old.tg_username, old.full_name, old."position", old.is_admin, old.is_active,
        old.default_rate, old.rating, old.pay_type, old.fixed_salary, old.sheet_alias, old.created_at)
    then
      raise exception 'Менять можно только аватар и рамку' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_guard_update on public.employees;
create trigger trg_employees_guard_update
  before update on public.employees
  for each row execute function public.employees_guard_update();

-- 2) Фиксируем search_path у трёх функций (предупреждение Supabase Advisors).
alter function public.auth_employee_id() set search_path = public;
alter function public.auth_is_admin() set search_path = public;
alter function public.notify_shift_request_event() set search_path = public;
