-- 2026-10-16: rol "supervisor" (sub-admin de solo lectura): ve clientes, tareas, eventos e informes de todo
-- el equipo. NO pagos (solo team@), NO usuarios, NO recordatorios/avisos/SMTP; edita solo lo suyo, como un miembro.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','member','supervisor'));
create or replace function public.is_supervisor() returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(select 1 from public.profiles p where p.id = auth.uid() and p.role = 'supervisor');
$$;
drop policy if exists rep_sel on public.reports;
create policy rep_sel on public.reports for select to authenticated using (user_email = public.my_email() or public.is_admin() or public.is_supervisor());
