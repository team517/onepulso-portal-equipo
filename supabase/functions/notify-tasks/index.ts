// Edge Function: el admin avisa por email a un compañero de las tareas que le ha
// asignado. Dos acciones:
//   action:'compose' -> redacta un borrador (asunto + mensaje) con IA si hay
//                       DEEPSEEK_API_KEY / OPENAI_API_KEY; si no, con una
//                       plantilla cuidada. No envía nada.
//   action:'send'    -> envía el correo por SMTP (config de smtp_config) con el
//                       mensaje + el listado de tareas al final.
// Solo un admin autenticado puede usarla.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  const d = new Date(p[0], p[1] - 1, p[2]);
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  return `${dias[d.getDay()]} ${p[2]} ${MESES[p[1] - 1]}`;
}

type Task = { title: string; date?: string | null; note?: string | null };

const firstName = (s: string) => String(s || "").trim().split(/\s+/)[0] || "";

function localCompose(name: string, tasks: Task[]): { subject: string; message: string } {
  const n = tasks.length;
  const subject = n === 1 ? "Tienes una tarea nueva en el portal" : `Tienes ${n} tareas nuevas en el portal`;
  const fn = firstName(name);
  const message =
    `Hola${fn ? " " + fn : ""},\n\n` +
    `Te he asignado ${n === 1 ? "una tarea" : n + " tareas"} en el Portal del equipo de OnePulso. ` +
    `Cuando puedas, entra al calendario para verlas con detalle y ve marcándolas como hechas según las vayas completando.\n\n` +
    `¡Gracias!`;
  return { subject, message };
}

async function aiCompose(name: string, tasks: Task[]): Promise<{ subject: string; message: string } | null> {
  const deepseek = Deno.env.get("DEEPSEEK_API_KEY");
  const openai = Deno.env.get("OPENAI_API_KEY");
  const endpoint = deepseek
    ? "https://api.deepseek.com/chat/completions"
    : openai
    ? "https://api.openai.com/v1/chat/completions"
    : null;
  const key = deepseek || openai;
  const model = deepseek ? "deepseek-chat" : "gpt-4o-mini";
  if (!endpoint || !key) return null;

  const lista = tasks
    .map((t) => `- ${t.title}${t.date ? ` (${fmtDate(t.date)})` : ""}${t.note ? ` — ${t.note}` : ""}`)
    .join("\n");
  const sys =
    "Eres el asistente del Portal del equipo de OnePulso. Redactas correos internos breves, cercanos y motivadores en español de España. " +
    "Avisa a un compañero de que tiene tareas asignadas y anímale a entrar al calendario del portal para verlas y marcarlas como hechas. " +
    "Tono profesional pero cálido y natural, sin sonar a robot y sin emojis. NO enumeres las tareas una a una (el sistema añade el listado aparte); " +
    "escribe solo un mensaje de 2-4 frases. Devuelve EXCLUSIVAMENTE un JSON válido con las claves \"subject\" (asunto corto) y \"message\" (el cuerpo, texto plano con saltos de línea, empezando por el saludo).";
  const usr = `Compañero: ${name || "(sin nombre)"}\nNúmero de tareas: ${tasks.length}\nTareas (solo como contexto, no las copies):\n${lista}`;

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
      }),
    });
    clearTimeout(to);
    if (!r.ok) return null;
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    const subject = String(parsed.subject || "").trim();
    const message = String(parsed.message || "").trim();
    if (!subject || !message) return null;
    return { subject, message };
  } catch (_e) {
    return null;
  }
}

function buildEmail(message: string, tasks: Task[]): { text: string; html: string } {
  const listText = tasks
    .map((t) => `• ${t.title}${t.date ? `  ·  ${fmtDate(t.date)}` : ""}${t.note ? `\n    ${t.note}` : ""}`)
    .join("\n");
  const text = `${message}\n\nTareas:\n${listText}\n\n— Portal del equipo OnePulso`;

  const msgHtml = esc(message)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const rows = tasks
    .map(
      (t) => `<tr><td style="padding:10px 14px;border:1px solid rgba(20,19,25,.08);border-radius:12px;background:#F7F6FC">
        <div style="font-weight:600;color:#141319">${esc(t.title)}</div>
        ${t.date ? `<div style="font-size:12.5px;color:#7A5AF8;font-weight:600;margin-top:2px">${esc(fmtDate(t.date))}</div>` : ""}
        ${t.note ? `<div style="font-size:13px;color:#57565F;margin-top:4px">${esc(t.note)}</div>` : ""}
      </td></tr><tr><td style="height:8px"></td></tr>`
    )
    .join("");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#141319;line-height:1.55;max-width:560px">
      ${msgHtml}
      <div style="font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#8B8699;margin:18px 0 8px">Tareas</div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate">${rows}</table>
      <p style="color:#8B8699;font-size:12px;margin-top:20px">Entra al portal para verlas en el calendario y marcarlas como hechas.<br>— Portal del equipo OnePulso</p>
    </div>`;
  return { text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Solo un admin autenticado
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: "No autenticado" });
    const admin = createClient(url, service);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") return json({ ok: false, error: "Solo el administrador puede enviar avisos" });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "compose");
    const to = String(body.to || "").trim().toLowerCase();
    const name = String(body.name || "");
    const tasks: Task[] = Array.isArray(body.tasks)
      ? body.tasks
          .map((t: Task) => ({ title: String(t.title || "").trim(), date: t.date || null, note: t.note ? String(t.note) : null }))
          .filter((t: Task) => t.title)
      : [];

    if (action === "compose") {
      if (!tasks.length) return json({ ok: false, error: "Selecciona al menos una tarea" });
      const ai = await aiCompose(name, tasks);
      const draft = ai || localCompose(name, tasks);
      return json({ ok: true, ...draft, ai: !!ai });
    }

    if (action === "send") {
      if (!to) return json({ ok: false, error: "Falta el destinatario" });
      if (!tasks.length) return json({ ok: false, error: "Selecciona al menos una tarea" });
      const { data: target } = await admin.from("profiles").select("email,name").eq("email", to).single();
      if (!target) return json({ ok: false, error: "El destinatario no es un usuario del equipo" });

      const { data: cfg } = await admin.from("smtp_config").select("host,port,username,pass,from_email").eq("id", "main").maybeSingle();
      const host = (cfg && cfg.host) || Deno.env.get("SMTP_HOST");
      const port = Number((cfg && cfg.port) || Deno.env.get("SMTP_PORT") || "465");
      const suser = (cfg && cfg.username) || Deno.env.get("SMTP_USER");
      const spass = (cfg && cfg.pass) || Deno.env.get("SMTP_PASS");
      if (!host || !suser || !spass) return json({ ok: false, error: "SMTP no configurado. Conéctalo desde el portal (botón Conectar correo)." });
      const from = (cfg && cfg.from_email) || Deno.env.get("SMTP_FROM") || suser;

      const subject = String(body.subject || "").trim() || "Tienes tareas nuevas en el portal";
      const message = String(body.message || "").trim() || localCompose(target.name || "", tasks).message;
      const { text, html } = buildEmail(message, tasks);

      const client = new SMTPClient({
        connection: { hostname: host, port, tls: port === 465, auth: { username: suser, password: spass } },
      });
      await client.send({ from, to, subject, content: text, html });
      await client.close();
      return json({ ok: true });
    }

    return json({ ok: false, error: "Acción no válida" });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
