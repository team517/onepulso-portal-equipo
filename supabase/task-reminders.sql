-- Recordatorio por tarea: hora de la tarea + "avisar X minutos antes".
-- El cron (send-reminders) manda el correo al responsable a esa hora.
alter table public.tasks     add column if not exists "time"           text;
alter table public.tasks     add column if not exists remind_before    int;   -- minutos antes (null = sin recordatorio)
alter table public.tasks     add column if not exists remind_sent_at   timestamptz;
alter table public.recurring add column if not exists remind_before    int;
alter table public.recurring add column if not exists last_remind_slot text;  -- 'YYYY-MM-DD' ya avisado (dedupe)
notify pgrst, 'reload schema';
