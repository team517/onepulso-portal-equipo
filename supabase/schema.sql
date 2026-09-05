-- ============================================================
--  OnePulso · Portal del equipo — esquema Supabase
--  Ejecutar en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- ---------- Tablas ----------

-- Un perfil por usuario de Auth (rol, nombre)
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  name       text not null default '',
  role       text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

-- Reuniones del calendario
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  date       date not null,
  title      text not null,
  color      text,
  created_at timestamptz not null default now()
);

-- Clientes
create table if not exists public.clients (
  id         bigint generated always as identity primary key,
  name       text not null,
  email      text,
  owner      uuid references public.profiles(id) on delete set null,
  status     text not null default 'on',
  created_at timestamptz not null default now()
);

-- Tareas (con estado terminado, nota/recomendación e imágenes)
create table if not exists public.tasks (
  id          bigint generated always as identity primary key,
  title       text not null,
  date        date,
  assignee    uuid references public.profiles(id) on delete set null,
  done        boolean not null default false,
  note        text,
  images      jsonb not null default '[]',   -- rutas en el bucket task-photos
  created_at  timestamptz not null default now()
);

-- ---------- Crear el perfil automáticamente al crear un usuario ----------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'member')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Seguridad (RLS) ----------
alter table public.profiles enable row level security;
alter table public.events   enable row level security;
alter table public.clients  enable row level security;
alter table public.tasks    enable row level security;

-- ¿el usuario actual es admin?
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin');
$$;

-- profiles: todos los del equipo (autenticados) pueden leer; cada uno edita el suyo; admin todo
drop policy if exists profiles_read        on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_admin_all   on public.profiles;
create policy profiles_read        on public.profiles for select to authenticated using (true);
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all   on public.profiles for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- events / clients / tasks: cualquier miembro autenticado del equipo puede leer y escribir
drop policy if exists events_rw  on public.events;
drop policy if exists clients_rw on public.clients;
drop policy if exists tasks_rw   on public.tasks;
create policy events_rw  on public.events  for all to authenticated using (true) with check (true);
create policy clients_rw on public.clients for all to authenticated using (true) with check (true);
create policy tasks_rw   on public.tasks   for all to authenticated using (true) with check (true);

-- ---------- Storage: bucket privado para las fotos de tareas ----------
insert into storage.buckets (id, name, public)
values ('task-photos', 'task-photos', false)
on conflict (id) do nothing;

drop policy if exists task_photos_read   on storage.objects;
drop policy if exists task_photos_write  on storage.objects;
drop policy if exists task_photos_delete on storage.objects;
create policy task_photos_read   on storage.objects for select to authenticated using (bucket_id = 'task-photos');
create policy task_photos_write  on storage.objects for insert to authenticated with check (bucket_id = 'task-photos');
create policy task_photos_delete on storage.objects for delete to authenticated using (bucket_id = 'task-photos');

-- ---------- Datos de ejemplo (reuniones) ----------
insert into public.events (date, title, color) values
  ('2026-09-02','09:30 · Standup', null),
  ('2026-09-03','11:00 · Discovery Nordic', null),
  ('2026-09-03','16:00 · Revisión copy', 'alt'),
  ('2026-09-07','10:00 · Comité semanal', null),
  ('2026-09-10','12:30 · Kickoff Cedra', null),
  ('2026-09-14','17:00 · Cierre de mes', 'amber'),
  ('2026-09-18','11:30 · Formación interna', 'amber'),
  ('2026-09-25','15:00 · Demo Ridge', 'alt')
on conflict do nothing;

-- ============================================================
--  DESPUÉS de ejecutar esto:
--  1) Authentication → Providers → Email: activa "Email", y para uso
--     interno DESACTIVA "Confirm email" (así el admin crea cuentas
--     y entran directas) y DESACTIVA "Allow new users to sign up".
--  2) Authentication → Users → Add user:
--        email: team@onepulso.online   contraseña: (la que quieras)
--  3) Vuelve al SQL Editor y hazte admin:
--        update public.profiles set role='admin' where email='team@onepulso.online';
-- ============================================================
