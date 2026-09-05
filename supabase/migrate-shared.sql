-- Datos COMPARTIDOS entre el equipo (calendario, tareas, clientes, recordatorios,
-- apuntes) en Supabase, con permisos por rol.

-- tasks y clients con id puesto por el cliente y responsable por email
drop table if exists public.tasks cascade;
create table public.tasks (
  id         bigint primary key,
  title      text not null,
  date       date,
  assignee   text,
  done       boolean not null default false,
  note       text,
  images     jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

drop table if exists public.clients cascade;
create table public.clients (
  id         bigint primary key,
  name       text not null,
  email      text,
  owner      text,
  status     text not null default 'on',
  created_at timestamptz not null default now()
);

-- recordatorios y apuntes generales (clave/valor)
create table if not exists public.app_kv (
  k text primary key,
  v jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tasks   enable row level security;
alter table public.clients enable row level security;
alter table public.app_kv  enable row level security;

create or replace function public.my_email() returns text language sql stable security definer set search_path=public as $$
  select email from public.profiles where id = auth.uid();
$$;

-- tasks: todos ven; admin todo; miembro solo las suyas (assignee = su email)
drop policy if exists tasks_sel on public.tasks;
drop policy if exists tasks_ins on public.tasks;
drop policy if exists tasks_upd on public.tasks;
drop policy if exists tasks_del on public.tasks;
create policy tasks_sel on public.tasks for select to authenticated using (true);
create policy tasks_ins on public.tasks for insert to authenticated with check (public.is_admin() or assignee = public.my_email());
create policy tasks_upd on public.tasks for update to authenticated using (public.is_admin() or assignee = public.my_email()) with check (public.is_admin() or assignee = public.my_email());
create policy tasks_del on public.tasks for delete to authenticated using (public.is_admin() or assignee = public.my_email());

-- clients: todos ven; solo admin escribe
drop policy if exists clients_sel on public.clients;
drop policy if exists clients_wr on public.clients;
create policy clients_sel on public.clients for select to authenticated using (true);
create policy clients_wr  on public.clients for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- app_kv: todos ven; solo admin escribe
drop policy if exists kv_sel on public.app_kv;
drop policy if exists kv_wr  on public.app_kv;
create policy kv_sel on public.app_kv for select to authenticated using (true);
create policy kv_wr  on public.app_kv for all    to authenticated using (public.is_admin()) with check (public.is_admin());
