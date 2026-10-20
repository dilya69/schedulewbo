-- Автоудаление 1-го числа (задание purge-old-shift-data) теперь чистит и пожелания по графику за прошлые месяцы.
-- Выполнить один раз в Supabase -> SQL Editor.
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

  -- пожелания по графику и переключатели приёма за прошлые месяцы
  delete from availability_wishes
  where month < cutoff;

  delete from wish_months
  where month < cutoff;
end;
$function$;
