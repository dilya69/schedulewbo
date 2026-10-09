-- Когда сотрудник откликается на смену, смена становится «pending» (оранжевая точка в календаре).
-- Раньше это делало приложение отдельным запросом, но менять смены может только админ,
-- и у обычного сотрудника запрос молча не срабатывал.
create or replace function public.mark_shift_pending_on_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.shifts
     set status = 'pending'
   where id = new.shift_id
     and status = 'free'
     and employee_id is null;
  return new;
end;
$$;

revoke all on function public.mark_shift_pending_on_request() from public, anon, authenticated;

drop trigger if exists trg_mark_shift_pending on public.shift_requests;
create trigger trg_mark_shift_pending
  after insert on public.shift_requests
  for each row execute function public.mark_shift_pending_on_request();
