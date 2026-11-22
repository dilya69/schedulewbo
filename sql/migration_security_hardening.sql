-- Закрытие дыр безопасности (проверка 2026-11-21). Выполнять в Supabase -> SQL Editor целиком.
-- Порядок важен: сначала это (SQL), потом деплой send-reminders и send-monthly-report.

-- 1) Сотрудник (не админ) может менять в своей карточке ТОЛЬКО эти поля.
--    Белый список: любое новое поле автоматически закрыто от самоправки.
--    Админ и серверные функции (service role) не затронуты.
create or replace function public.employees_guard_update()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  free text[] := array['avatar_emoji','avatar_frame','avatar_photo_url','avatar_use_photo','birth_day','birth_month','phone'];
begin
  if auth.role() = 'authenticated' and not public.auth_is_admin() then
    if (to_jsonb(new) - free) is distinct from (to_jsonb(old) - free) then
      raise exception 'Менять можно только аватар, рамку, телефон и дату рождения' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_guard_update on public.employees;
create trigger trg_employees_guard_update
  before update on public.employees
  for each row execute function public.employees_guard_update();

-- 2) Зарплатные поля (default_rate, rating, pay_type, fixed_salary) больше не читаются через API:
--    их не использует ни приложение, ни функции, а видели их все сотрудники.
--    ВАЖНО: из-за этого select("*") по employees больше не работает, приложение читает явный
--    список колонок (js/api.js, getEmployees). Новую колонку в employees нужно добавить сюда
--    (grant select (колонка) ...) и в этот список.
revoke select on public.employees from anon, authenticated;
grant select (id, tg_id, tg_username, full_name, "position", avatar_emoji, is_admin, is_active,
              created_at, avatar_frame, sheet_alias, avatar_photo_url, avatar_use_photo,
              birth_day, birth_month, phone, camera_access, real_name, last_seen_at,
              trainee_from, help_pvz_ids)
  on public.employees to authenticated;

-- 3) Секрет для cron: send-reminders и send-monthly-report принимают запрос только с ним.
insert into public.bot_secrets(key, value)
select 'cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
where not exists (select 1 from public.bot_secrets where key = 'cron');

select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'send-shift-reminders'), command := $c$
  select net.http_post(
    url := 'https://gwkurcwggttztchmhvzy.functions.supabase.co/send-reminders',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.bot_secrets where key='cron'))
  );
$c$);
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'send-monthly-report'), command := $c$
  select net.http_post(
    url := 'https://gwkurcwggttztchmhvzy.functions.supabase.co/send-monthly-report',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.bot_secrets where key='cron'))
  );
$c$);
