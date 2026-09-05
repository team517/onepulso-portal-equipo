-- Config SMTP editable desde el portal (solo admin). La contraseña queda
-- protegida por RLS (solo admin y service_role la leen). Una vista pública
-- expone solo el correo + estado (sin contraseña) para el "tag" que ven todos.

create table if not exists public.smtp_config (
  id         text primary key default 'main',
  host       text,
  port       int  default 465,
  username   text,
  pass       text,
  from_email text,
  updated_at timestamptz not null default now()
);

alter table public.smtp_config enable row level security;
drop policy if exists smtp_admin on public.smtp_config;
create policy smtp_admin on public.smtp_config
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Vista pública: solo correo remitente + si está conectado (sin contraseña)
create or replace view public.smtp_public as
  select from_email, (pass is not null and pass <> '') as connected
  from public.smtp_config
  where id = 'main';

grant select on public.smtp_public to authenticated, anon;
