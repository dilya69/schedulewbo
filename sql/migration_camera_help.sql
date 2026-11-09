alter table public.employees add column if not exists camera_access boolean not null default false;
comment on column public.employees.camera_access is 'Доступ к камерам: этих людей бот упоминает по команде /помогите в группе';
create table if not exists public.help_chats (
  chat_id bigint primary key,
  title text,
  created_at timestamptz not null default now()
);
alter table public.help_chats enable row level security;
