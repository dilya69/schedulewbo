-- Время последнего входа сотрудника (приложение и бот). Одна дата на человека, перезаписывается.
alter table employees add column if not exists last_seen_at timestamptz;
comment on column employees.last_seen_at is 'Последний вход в приложение или бота; админ смотрит кнопкой «Последний вход» в боте';
