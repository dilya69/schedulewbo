-- Автоудаление пожеланий за прошлые месяцы.
-- purge_old_shift_data() уже запускается cron-задачей purge-old-shift-data
-- (1-го числа каждого месяца в 03:00 UTC). Добавляем в неё чистку availability_wishes:
-- пожелания за месяцы раньше текущего удаляются вместе со сменами и бонусами/штрафами.
-- Пожелания на текущий и будущие месяцы не трогаем.

create or replace function public.purge_old_shift_data()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cutoff date := date_trunc('month', now())::date;
begin
  delete from shift_requests
  where shift_id in (select id from shifts where shift_date < cutoff);

  delete from shifts
  where shift_date < cutoff;

  delete from bonuses_fines
  where period_month < cutoff;

  delete from availability_wishes
  where month < cutoff;
end;
$function$;
