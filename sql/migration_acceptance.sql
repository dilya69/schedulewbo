-- Приёмка (WB): мотивация за скорость приёмки утренней поставки.
-- Файл с сайта WB грузится в бота в конце месяца; бот делит сумму поровну между теми, кто в этот день
-- работал с 9:00 на этом ПВЗ. Админ отмечает «засчитать / не засчитывать», засчитанное идёт в зарплату.

-- ID ПВЗ в системе WB (из файла) — вносится один раз в настройках ПВЗ
alter table public.pvz add column if not exists wb_id text;

create table if not exists public.acceptance_bonuses (
  id uuid primary key default gen_random_uuid(),
  wb_pvz_id text not null,
  pvz_id uuid references public.pvz(id) on delete set null,
  address text,
  bonus_date date not null,
  amount numeric not null,                       -- может быть отрицательной (штраф за просрочку)
  shares jsonb not null default '[]'::jsonb,     -- [{employee_id, amount}] — доли утренних сотрудников
  status text not null default 'pending' check (status in ('pending','counted','skipped')),
  created_at timestamptz not null default now(),
  unique (wb_pvz_id, bonus_date)
);
create index if not exists acceptance_bonuses_date_idx on public.acceptance_bonuses(bonus_date);
alter table public.acceptance_bonuses enable row level security;

-- читать: админ или сотрудник, у которого есть доля; писать: только админ
drop policy if exists ab_select on public.acceptance_bonuses;
create policy ab_select on public.acceptance_bonuses
  for select to authenticated using (
    public.auth_is_admin()
    or shares @> jsonb_build_array(jsonb_build_object('employee_id', public.auth_employee_id()::text))
  );

drop policy if exists ab_write_admin on public.acceptance_bonuses;
create policy ab_write_admin on public.acceptance_bonuses
  for all to authenticated using (public.auth_is_admin()) with check (public.auth_is_admin());

-- автоудаление за прошлые месяцы вместе со сменами (1-го числа, как и остальное)
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

  delete from acceptance_bonuses
  where bonus_date < cutoff;
end;
$function$;
