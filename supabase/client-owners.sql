-- 2026-10-12: un cliente puede tener VARIOS responsables (etiquetas). `owner` sigue siendo el principal.
alter table public.clients add column if not exists owners text[] not null default '{}';
update public.clients set owners = array[owner] where owner is not null and owner <> '' and owners = '{}';
