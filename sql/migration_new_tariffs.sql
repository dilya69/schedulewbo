-- Новые тарифы (2026-11-11).
-- Полная смена (от открытия до закрытия) = фиксированная сумма ПВЗ (pvz.full_shift_pay).
-- Любая другая смена = часы × 250 ₽/ч (начало до 17:00) или × 200 ₽/ч (с 17:00): ставки зашиты в приложении.
-- Стажёр (слово «стажер» в должности): месяц со дня первой смены (employees.trainee_from),
-- полная смена 2700 ₽ (не больше суммы ПВЗ), остальные смены по 200 ₽/ч.

-- 1) суммы за полную смену
update pvz set full_shift_pay = case name
  when 'Тургенева WB'        then 3200
  when 'Ярославский 1 WB'    then 2500
  when 'Ярославский 1 Ozon'  then 2000
  else 3000
end;

-- 2) старые правила по часовым окнам и «вечерние» суммы больше не используются
delete from pvz_pay_rules;

-- 3) дата начала стажировки
alter table employees add column if not exists trainee_from date;
comment on column employees.trainee_from is 'Дата первой смены стажёра: стажировка (ставка 2700 за полную смену) идёт месяц с этого дня';

-- при установке «стажер» в должности — ставим дату по первой уже имеющейся смене
create or replace function set_trainee_from_on_employee() returns trigger
language plpgsql as $$
begin
  if new.position ~* 'стаж[её]р' and new.trainee_from is null then
    new.trainee_from := (select min(shift_date) from shifts where employee_id = new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_trainee_employee on employees;
create trigger trg_trainee_employee
  before insert or update of position on employees
  for each row execute function set_trainee_from_on_employee();

-- у стажёра без даты первой сменой становится дата самой ранней его смены
create or replace function set_trainee_from_on_shift() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null then
    update employees set trainee_from = new.shift_date
    where id = new.employee_id
      and position ~* 'стаж[её]р'
      and (trainee_from is null or new.shift_date < trainee_from);
  end if;
  return new;
end $$;

drop trigger if exists trg_trainee_shift on shifts;
create trigger trg_trainee_shift
  after insert or update of employee_id, shift_date on shifts
  for each row execute function set_trainee_from_on_shift();

-- уже существующие стажёры
update employees e set trainee_from = (select min(shift_date) from shifts s where s.employee_id = e.id)
where e.position ~* 'стаж[её]р' and e.trainee_from is null;
