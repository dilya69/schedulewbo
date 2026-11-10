-- Типы надбавок с гибкими правилами (конструктор в приложении). Правило хранится как jsonb:
-- { pay:{mode:fixed|per_shift|per_hour|percent, amount}, when:{type:half_month|month|dates|weekdays, dates:[], weekdays:[]},
--   cond:{pvz:[id], weekdays:[1..7], hours_from, hours_to, min_shifts} }
create table if not exists public.allowance_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  rule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.allowance_types enable row level security;

drop policy if exists at_select on public.allowance_types;
create policy at_select on public.allowance_types for select to authenticated using (true);
drop policy if exists at_write_admin on public.allowance_types;
create policy at_write_admin on public.allowance_types for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());

-- назначение: тип + необязательная своя сумма (если пусто — берётся сумма из правила типа)
alter table public.employee_allowances add column if not exists type_id uuid references public.allowance_types(id) on delete restrict;
alter table public.employee_allowances alter column amount drop not null;
alter table public.employee_allowances drop constraint if exists employee_allowances_amount_check;
alter table public.employee_allowances add constraint employee_allowances_amount_check check (amount is null or amount > 0);

insert into public.allowance_types (name, rule) values
 ('Тикеты', '{"pay":{"mode":"fixed","amount":5000},"when":{"type":"half_month","dates":[],"weekdays":[]},"cond":{"pvz":[],"weekdays":[],"hours_from":null,"hours_to":null,"min_shifts":null}}')
on conflict (name) do nothing;

update public.employee_allowances
set type_id = (select id from public.allowance_types where name = 'Тикеты'), amount = null
where kind = 'Тикеты' and type_id is null;
