-- Телефон сотрудника (показывается кнопкой у Ивана, Светланы и Яны)
alter table public.employees add column if not exists phone text;
comment on column public.employees.phone is 'Телефон для кнопки звонка в списке сотрудников';
