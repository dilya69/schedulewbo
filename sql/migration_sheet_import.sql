-- Импорт графика из Excel: три новые колонки.
-- Выполнить один раз: Supabase -> SQL Editor -> вставить -> Run.

-- откуда взялась смена: 'sheet' = принёс импорт из таблицы (только такие импорт может удалить)
alter table public.shifts    add column if not exists source text;

-- как человека пишут в таблице («Кристина П;Крис») — псевдонимы через «;»
alter table public.employees add column if not exists sheet_alias text;

-- как ПВЗ называется в таблице («Ярославский к1 OZON»)
alter table public.pvz       add column if not exists sheet_title text;
