// Edge Function: envia los recordatorios programados (tabla reminders_sched).
// - Lo llama un cron (pg_cron) cada minuto con la cabecera x-cron-secret ->
//   procesa los recordatorios que tocan a esta hora (Europe/Madrid).
// - Tambien lo puede llamar un admin con { action:'test', id } para enviar YA
//   un recordatorio concreto (para probarlo).
// Envia por SMTP (tabla smtp_config) y opcionalmente adjunta las tareas de hoy
// del destinatario.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtDate(iso: string): string {
  if (!iso) return "Sin fecha";
  const p = String(iso).split("-").map(Number);
  if (p.length < 3 || !p[0]) return String(iso);
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${dias[new Date(p[0], p[1] - 1, p[2]).getDay()]} ${p[2]} ${MESES[p[1] - 1]}`;
}

// Hora actual en Europe/Madrid
function madridNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const hh = +g("hour"), mm = +g("minute");
  const wdMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { minutes: hh * 60 + mm, date: `${g("year")}-${g("month")}-${g("day")}`, wd: wdMap[g("weekday")] ?? 0 };
}

type Task = { title: string; date?: string | null; note?: string | null; rec?: boolean };

function normTime(t: string): { min: number; hhmm: string } | null {
  const m = String(t || "").match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Math.min(23, +m[1]), mi = Math.min(59, +m[2]);
  return { min: h * 60 + mi, hhmm: String(h).padStart(2, "0") + ":" + String(mi).padStart(2, "0") };
}

function buildEmail(title: string, message: string, tasks: Task[], listHeader = "Tus tareas de hoy"): { text: string; html: string } {
  const hasList = tasks.length > 0;
  const listText = hasList
    ? tasks.map((t) => `• ${t.title}${t.rec ? " (cada semana)" : ""}${t.date ? `  ·  ${fmtDate(t.date)}` : ""}${t.note ? `\n    ${t.note}` : ""}`).join("\n")
    : "No tienes tareas pendientes para hoy.";
  const text = `${message}\n\n${hasList ? listHeader + ":\n" + listText : listText}\n\n— Portal del equipo OnePulso`;

  const msgHtml = esc(message).split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`).join("");
  const rows = tasks.map((t) => `<tr><td style="padding:10px 14px;border:1px solid rgba(20,19,25,.08);border-radius:12px;background:#F7F6FC">
      <div style="font-weight:600;color:#141319">${esc(t.title)}${t.rec ? ' <span style="font-size:11px;color:#7A5AF8">🔁 cada semana</span>' : ""}</div>
      ${t.date ? `<div style="font-size:12.5px;color:#7A5AF8;font-weight:600;margin-top:2px">${esc(fmtDate(t.date))}</div>` : ""}
      ${t.note ? `<div style="font-size:13px;color:#57565F;margin-top:4px">${esc(t.note)}</div>` : ""}
    </td></tr><tr><td style="height:8px"></td></tr>`).join("");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#141319;line-height:1.55;max-width:560px">
      ${title ? `<div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7A5AF8;margin:0 0 6px">⏰ ${esc(title)}</div>` : ""}
      ${msgHtml}
      ${hasList
        ? `<div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8B8699;margin:18px 0 8px">${esc(listHeader)}</div>
           <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate">${rows}</table>`
        : `<p style="color:#57565F">No tienes tareas pendientes para hoy. ¡Buen trabajo!</p>`}
      <p style="color:#8B8699;font-size:12px;margin-top:20px">Entra al portal para verlas y marcarlas como hechas.<br>— Portal del equipo OnePulso</p>
    </div>`;
  return { text, html };
}

// deno-lint-ignore no-explicit-any
async function tasksForToday(admin: any, email: string, today: string, wd: number): Promise<Task[]> {
  const out: Task[] = [];
  const { data: one } = await admin.from("tasks").select("title,date,note,details,done").eq("assignee", email).eq("date", today).eq("done", false);
  (one || []).forEach((t: Record<string, unknown>) => out.push({ title: String(t.title), date: today, note: (t.details as string) || (t.note as string) || null }));
  // recurrentes que tocan hoy (excluyendo las ya completadas hoy)
  const { data: recs } = await admin.from("recurring").select("id,title,details,weekdays,assignee").eq("assignee", email);
  if (recs && recs.length) {
    const { data: doneToday } = await admin.from("tasks").select("rec_id").eq("assignee", email).eq("date", today).eq("done", true);
    const doneSet = new Set((doneToday || []).map((r: Record<string, unknown>) => Number(r.rec_id)).filter(Boolean));
    (recs as Record<string, unknown>[]).forEach((r) => {
      const wds = Array.isArray(r.weekdays) ? (r.weekdays as number[]) : [];
      if (wds.includes(wd) && !doneSet.has(Number(r.id))) out.push({ title: String(r.title), date: null, note: (r.details as string) || null, rec: true });
    });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function getSmtp(admin: any) {
  const { data: cfg } = await admin.from("smtp_config").select("host,port,username,pass,from_email").eq("id", "main").maybeSingle();
  const host = (cfg && cfg.host) || Deno.env.get("SMTP_HOST");
  const port = Number((cfg && cfg.port) || Deno.env.get("SMTP_PORT") || "465");
  const suser = (cfg && cfg.username) || Deno.env.get("SMTP_USER");
  const spass = (cfg && cfg.pass) || Deno.env.get("SMTP_PASS");
  const from = (cfg && cfg.from_email) || Deno.env.get("SMTP_FROM") || suser;
  if (!host || !suser || !spass) return null;
  return { host, port, suser, spass, from };
}

// deno-lint-ignore no-explicit-any
async function sendReminder(admin: any, smtp: any, rem: Record<string, unknown>, today: string, wd: number): Promise<number> {
  // destinatarios
  let recipients: { email: string; name: string }[] = [];
  if (rem.target === "all") {
    const { data } = await admin.from("profiles").select("email,name");
    recipients = (data || []).map((p: Record<string, unknown>) => ({ email: String(p.email), name: String(p.name || p.email) }));
  } else {
    const { data } = await admin.from("profiles").select("email,name").eq("email", String(rem.target)).maybeSingle();
    if (data) recipients = [{ email: String(data.email), name: String(data.name || data.email) }];
  }
  const title = String(rem.title || "Recordatorio");
  const message = String(rem.message || "Este es tu recordatorio para revisar tus tareas del día.");
  const include = rem.include_tasks !== false;

  // deno-lint-ignore no-explicit-any
  let client: any = null;
  let sent = 0;
  try {
    for (const r of recipients) {
      const tasks = include ? await tasksForToday(admin, r.email, today, wd) : [];
      // en 'all' con tareas activadas, no molestar a quien no tiene nada hoy
      if (rem.target === "all" && include && tasks.length === 0) continue;
      const greeting = message.replace(/\{nombre\}/gi, (r.name || "").split(" ")[0] || "");
      const { text, html } = buildEmail(title, greeting, tasks);
      if (!client) client = new SMTPClient({ connection: { hostname: smtp.host, port: smtp.port, tls: smtp.port === 465, auth: { username: smtp.suser, password: smtp.spass } } });
      await client.send({ from: smtp.from, to: r.email, subject: title, content: text, html });
      sent++;
    }
  } finally {
    if (client) { try { await client.close(); } catch (_e) { /* nunca conectó */ } }
  }
  return sent;
}

const dayNum = (d: string) => Math.floor(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000);
function addDaysStr(d: string, n: number): string {
  const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function whenPhrase(before: number, hhmm: string): string {
  if (before <= 0) return `ahora (a las ${hhmm})`;
  if (before >= 1440) return `mañana a las ${hhmm}`;
  if (before >= 60) { const h = Math.round(before / 60); return `dentro de ${h} ${h === 1 ? "hora" : "horas"} (a las ${hhmm})`; }
  return `en ${before} min (a las ${hhmm})`;
}

// deno-lint-ignore no-explicit-any
async function sendTaskReminder(admin: any, smtp: any, task: Record<string, unknown>, hhmm: string, before: number): Promise<boolean> {
  const to = String(task.assignee || "");
  if (!to) return false;
  const { data: prof } = await admin.from("profiles").select("name").eq("email", to).maybeSingle();
  const fn = prof && prof.name ? String(prof.name).split(" ")[0] : "";
  const message = `Hola${fn ? " " + fn : ""}, te recuerdo que ${whenPhrase(before, hhmm)} tienes esta tarea:`;
  const note = (task.details as string) || (task.note as string) || null;
  const list: Task[] = [{ title: String(task.title), date: (task.date as string) || null, note, rec: !!task.rec }];
  const { text, html } = buildEmail("Recordatorio de tarea", message, list, "La tarea");
  const client = new SMTPClient({ connection: { hostname: smtp.host, port: smtp.port, tls: smtp.port === 465, auth: { username: smtp.suser, password: smtp.spass } } });
  try { await client.send({ from: smtp.from, to, subject: `⏰ Recordatorio: ${String(task.title)}`, content: text, html }); }
  finally { try { await client.close(); } catch (_e) { /* nunca conectó */ } }
  return true;
}

// deno-lint-ignore no-explicit-any
async function processTaskReminders(admin: any, smtp: any, now: { date: string; minutes: number; wd: number }): Promise<number> {
  const nowVal = dayNum(now.date) * 1440 + now.minutes;
  let sent = 0;
  // Tareas sueltas: hora + remind_before, no hechas, sin avisar aún
  const { data: tks } = await admin.from("tasks")
    .select("id,title,date,time,assignee,details,note,remind_before")
    .not("remind_before", "is", null).eq("done", false).is("remind_sent_at", null).not("assignee", "is", null);
  for (const t of tks || []) {
    if (!t.date || !t.time || !t.assignee) continue;
    const nt = normTime(String(t.time)); if (!nt) continue;
    const fireVal = dayNum(String(t.date)) * 1440 + nt.min - Number(t.remind_before || 0);
    const diff = nowVal - fireVal;
    if (diff < 0 || diff > 10) continue;
    try { if (await sendTaskReminder(admin, smtp, t, nt.hhmm, Number(t.remind_before || 0))) sent++; } catch (_e) { /* seguir con las demás */ }
    await admin.from("tasks").update({ remind_sent_at: new Date().toISOString() }).eq("id", t.id);
  }
  // Recurrentes: remind_before sobre la ocurrencia (hoy o mañana), dedupe por día
  const { data: recs } = await admin.from("recurring")
    .select("id,title,time,weekdays,assignee,details,remind_before,last_remind_slot")
    .not("remind_before", "is", null).not("assignee", "is", null);
  for (const r of recs || []) {
    if (!r.time || !r.assignee) continue;
    const nt = normTime(String(r.time)); if (!nt) continue;
    const wds = Array.isArray(r.weekdays) ? r.weekdays : [];
    for (const add of [0, 1]) {
      const occWd = (now.wd + add) % 7;
      if (!wds.includes(occWd)) continue;
      const occDate = addDaysStr(now.date, add);
      const fireVal = dayNum(occDate) * 1440 + nt.min - Number(r.remind_before || 0);
      const diff = nowVal - fireVal;
      if (diff < 0 || diff > 10) continue;
      if (r.last_remind_slot === occDate) continue;
      const { data: doneRow } = await admin.from("tasks").select("id").eq("assignee", r.assignee).eq("date", occDate).eq("rec_id", r.id).eq("done", true).maybeSingle();
      if (!doneRow) {
        try { if (await sendTaskReminder(admin, smtp, { title: r.title, date: occDate, time: r.time, assignee: r.assignee, details: r.details, rec: true }, nt.hhmm, Number(r.remind_before || 0))) sent++; } catch (_e) { /* seguir */ }
      }
      await admin.from("recurring").update({ last_remind_slot: occDate }).eq("id", r.id);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, service);

    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    const isCron = cronSecret && req.headers.get("x-cron-secret") === cronSecret;

    const now = madridNow();
    const smtp = await getSmtp(admin);

    // --- Modo test (admin) ---
    if (!isCron) {
      const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return json({ ok: false, error: "No autenticado" });
      const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
      if (!prof || prof.role !== "admin") return json({ ok: false, error: "Solo el administrador" });
      const body = await req.json().catch(() => ({}));
      if (body.action !== "test") return json({ ok: false, error: "Acción no válida" });
      if (!smtp) return json({ ok: false, error: "SMTP no configurado. Conéctalo desde el portal (botón Conectar correo)." });
      const { data: rem } = await admin.from("reminders_sched").select("*").eq("id", body.id).maybeSingle();
      if (!rem) return json({ ok: false, error: "Recordatorio no encontrado" });
      const sent = await sendReminder(admin, smtp, rem, now.date, now.wd);
      return json({ ok: true, sent });
    }

    // --- Modo cron: procesar los que tocan ahora ---
    if (!smtp) return json({ ok: true, skipped: "sin SMTP" });
    const { data: rems } = await admin.from("reminders_sched").select("*").eq("active", true);
    let total = 0;
    const processed: number[] = [];
    for (const rem of rems || []) {
      const wds = Array.isArray(rem.weekdays) ? rem.weekdays : [];
      if (!wds.includes(now.wd)) continue;
      const nt = normTime(String(rem.time));
      if (!nt) continue;
      const diff = now.minutes - nt.min;
      if (diff < 0 || diff > 10) continue;              // solo si toca en los últimos 10 min
      const slot = `${now.date} ${nt.hhmm}`;
      if (rem.last_sent_slot === slot) continue;         // ya enviado en este turno
      try { total += await sendReminder(admin, smtp, rem, now.date, now.wd); } catch (_e) { /* seguir con los demás */ }
      await admin.from("reminders_sched").update({ last_sent_slot: slot, last_sent_at: new Date().toISOString() }).eq("id", rem.id);
      processed.push(Number(rem.id));
    }
    const taskReminders = await processTaskReminders(admin, smtp, now);
    return json({ ok: true, processed, total, taskReminders });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
