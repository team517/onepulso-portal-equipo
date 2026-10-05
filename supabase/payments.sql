-- Pagos (solo admin/team@): registro manual de pagos que nos deben / cobrados
create table if not exists public.payments (
  id         bigint primary key,
  client     text,
  concept    text,
  amount      numeric(12,2),
  currency   text not null default 'EUR',
  due_date   date,
  kind       text not null default 'unico',       -- 'mensualidad' | 'unico'
  status     text not null default 'pendiente',   -- 'pendiente' | 'cobrado'
  note       text,
  created_by text,
  created_at timestamptz not null default now()
);
alter table public.payments enable row level security;
drop policy if exists payments_admin on public.payments;
create policy payments_admin on public.payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
do $$ begin
  begin alter publication supabase_realtime add table public.payments; exception when duplicate_object then null; when others then null; end;
end $$;
