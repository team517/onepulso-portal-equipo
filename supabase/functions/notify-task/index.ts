// Edge Function: avisa por email (SMTP, desde team@onepulso.online) al
// responsable cuando el admin le asigna una tarea.
// Secrets necesarios: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (y opcional SMTP_FROM).
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Solo un admin autenticado puede disparar avisos
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: "No autenticado" });
    const admin = createClient(url, service);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") return json({ ok: false, error: "Solo el administrador puede enviar avisos" });

    const body = await req.json().catch(() => ({}));
    const to = String(body.to || "").trim().toLowerCase();
    if (!to) return json({ ok: false, error: "Falta el destinatario" });
    const { data: target } = await admin.from("profiles").select("email,name").eq("email", to).single();
    if (!target) return json({ ok: false, error: "El destinatario no es un usuario del equipo" });

    const host = Deno.env.get("SMTP_HOST");
    const port = Number(Deno.env.get("SMTP_PORT") || "465");
    const suser = Deno.env.get("SMTP_USER");
    const spass = Deno.env.get("SMTP_PASS");
    if (!host || !suser || !spass) return json({ ok: false, error: "SMTP no configurado (faltan secrets)" });
    const from = Deno.env.get("SMTP_FROM") || suser;

    const title = String(body.title || "Tarea");
    const dateTxt = body.date ? (" para el " + String(body.date)) : "";
    const noteTxt = body.note ? ("\n\nNota: " + String(body.note)) : "";
    const text = `Hola ${target.name || ""},\n\nSe te ha asignado una tarea${dateTxt}:\n\n• ${title}${noteTxt}\n\n— Portal del equipo OnePulso`;
    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#141319;line-height:1.5">
      <p>Hola ${target.name || ""},</p>
      <p>Se te ha asignado una tarea${dateTxt}:</p>
      <p style="font-size:16px;font-weight:600;color:#5B3AD9;margin:12px 0">${title}</p>
      ${body.note ? `<p style="color:#57565F">${String(body.note)}</p>` : ""}
      <p style="color:#8B8699;font-size:12px;margin-top:20px">— Portal del equipo OnePulso</p>
    </div>`;

    const client = new SMTPClient({
      connection: { hostname: host, port, tls: port === 465, auth: { username: suser, password: spass } },
    });
    await client.send({ from, to, subject: "Nueva tarea: " + title, content: text, html });
    await client.close();
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
