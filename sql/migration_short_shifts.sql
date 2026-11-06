-- Короткие смены «на N часов» без точного времени («Женя 2ч»).
-- В duration_minutes лежит длительность; start_time/end_time остаются условными (от открытия ПВЗ),
-- чтобы работали часы, отчёты и оплата. У обычных смен поле пустое (NULL).
-- Выполнять ДО деплоя новых версий функций и приложения.
alter table public.shifts
  add column if not exists duration_minutes integer
  check (duration_minutes is null or (duration_minutes > 0 and duration_minutes <= 720));

comment on column public.shifts.duration_minutes is
  'Смена на N минут без точного времени (импорт «Женя 2ч» или флажок «Короткая смена» в приложении). NULL — обычная смена со временем.';
