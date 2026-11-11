-- Автоудаление теперь хранит два месяца: текущий и прошлый.
-- cron-задача purge-old-shift-data (1-го числа каждого месяца в 03:00 UTC) удаляет данные
-- за месяцы раньше ПРОШЛОГО (то есть на 1 декабря уходит октябрь, ноябрь остаётся).
-- Чистятся: смены, заявки на смены, бонусы/штрафы, пожелания, приёмка WB.

create or replace function public.purge_old_shift_data()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cutoff date := date_trunc('month', now() - interval '1 month')::date;
begin
  delete from shift_requests
  where shift_id in (select id from shifts where shift_date < cutoff);

  delete from shifts
  where shift_date < cutoff;

  delete from bonuses_fines
  where period_month < cutoff;

  delete from availability_wishes
  where month < cutoff;

  delete from acceptance_bonuses
  where bonus_date < cutoff;
end;
$function$;
