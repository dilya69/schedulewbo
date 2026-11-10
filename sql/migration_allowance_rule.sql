-- Правило начисления надбавки (half_month = каждые 2 недели: за 1–15 и за 16–конец). Новые правила добавляются позже.
alter table public.employee_allowances add column if not exists rule text not null default 'half_month';
