alter table public.events add column if not exists "time"      text;
alter table public.events add column if not exists assignee    text;
alter table public.events add column if not exists client      text;
alter table public.events add column if not exists note        text;
alter table public.events add column if not exists created_by  text;
delete from public.events;  -- quitar los 8 de relleno del diseño
alter table public.events enable row level security;
drop policy if exists events_sel on public.events;
drop policy if exists events_ins on public.events;
drop policy if exists events_upd on public.events;
drop policy if exists events_del on public.events;
create policy events_sel on public.events for select to authenticated using (true);
create policy events_ins on public.events for insert to authenticated with check (public.is_admin() or assignee = public.my_email());
create policy events_upd on public.events for update to authenticated using (public.is_admin() or assignee = public.my_email()) with check (public.is_admin() or assignee = public.my_email());
create policy events_del on public.events for delete to authenticated using (public.is_admin() or created_by = public.my_email());
do $$ begin
  begin alter publication supabase_realtime add table public.events; exception when duplicate_object then null; when others then null; end;
end $$;
notify pgrst, 'reload schema';
