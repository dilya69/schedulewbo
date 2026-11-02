-- Фото из Telegram как аватар (2026-11-02).
-- Выполнить в Supabase -> SQL Editor. Сначала SQL, потом выкладывать код приложения.

-- avatar_photo_url — ссылка на фото профиля Telegram (приложение обновляет её при входе;
--   если у человека фото скрыто настройками приватности, ссылка очищается).
-- avatar_use_photo — true: показывать фото (если оно доступно), иначе эмодзи; false: всегда эмодзи.
alter table public.employees
  add column if not exists avatar_photo_url text,
  add column if not exists avatar_use_photo boolean not null default true;

-- Кто сам выбирал эмодзи (не стандартный 👤) — остаются на своём эмодзи.
update public.employees
   set avatar_use_photo = false
 where avatar_emoji is not null and avatar_emoji <> '👤';

-- В поле можно хранить только ссылку на аватар Telegram — чужие ссылки через API не примутся.
alter table public.employees drop constraint if exists employees_avatar_photo_url_chk;
alter table public.employees
  add constraint employees_avatar_photo_url_chk
  check (avatar_photo_url is null or avatar_photo_url like 'https://t.me/i/userpic/%');
