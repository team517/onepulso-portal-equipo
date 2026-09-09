-- Recordatorios programados: el admin fija hora + dias de la semana y a esa hora
-- se envia un correo (opcionalmente con las tareas de hoy del destinatario).
-- El envio lo dispara un cron cada minuto -> edge function send-reminders.
create table if not exists public.reminders_sched (
  id             bigint primary key,
  title          text,
  message        text,
  time           text not null,                               -- 'HH:MM' (hora de Madrid)
  weekdays       jsonb not null default '[0,1,2,3,4,5,6]'::jsonb, -- lunes=0 .. domingo=6
  target         text not null default 'all',                 -- email del usuario o 'all'
  include_tasks  boolean not null default true,               -- adjuntar tareas de hoy
  active         boolean not null default true,
  last_sent_slot text,                                        -- 'YYYY-MM-DD HH:MM' ya enviado (dedupe)
  last_sent_at   timestamptz,
  created_by     text,
  created_at     timestamptz not null default now()
);

alter table public.reminders_sched enable row level security;

drop policy if exists rs_sel on public.reminders_sched;
drop policy if exists rs_wr  on public.reminders_sched;
create policy rs_sel on public.reminders_sched for select to authenticated using (true);
create policy rs_wr  on public.reminders_sched for all    to authenticated using (public.is_admin()) with check (public.is_admin());

do $$ begin
  begin
    alter publication supabase_realtime add table public.reminders_sched;
  exception when duplicate_object then null; when others then null;
  end;
end $$;
