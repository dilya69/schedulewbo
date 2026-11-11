-- Напоминания о сменах отключить нельзя: push_enabled всегда true.
-- Сотрудники выбирают только время и периодичность.
update notification_settings set push_enabled = true where push_enabled is distinct from true;

create or replace function force_push_enabled() returns trigger
language plpgsql as $$
begin
  new.push_enabled := true;
  return new;
end $$;

drop trigger if exists trg_force_push_enabled on notification_settings;
create trigger trg_force_push_enabled
  before insert or update on notification_settings
  for each row execute function force_push_enabled();
