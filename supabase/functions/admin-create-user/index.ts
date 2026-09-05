// Edge Function: solo un admin puede crear o borrar usuarios.
// Usa la service_role (inyectada por Supabase) en un entorno protegido.
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Respuestas de negocio siempre 200 con {ok, error?} para que el frontend las lea fácil.
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: "No autenticado" });

    const admin = createClient(url, service);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") return json({ ok: false, error: "Solo el administrador puede gestionar usuarios" });

    const body = await req.json().catch(() => ({}));
    const action = body.action || "create";

    if (action === "create") {
      const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@onepulso\.online$/.test(email)) return json({ ok: false, error: "El correo debe terminar en @onepulso.online" });
      if (!body.password || String(body.password).length < 6) return json({ ok: false, error: "La contraseña debe tener al menos 6 caracteres" });
      const role = body.role === "admin" ? "admin" : "member";
      const name = String(body.name || "");
      const { data, error } = await admin.auth.admin.createUser({
        email, password: String(body.password), email_confirm: true,
        user_metadata: { name, role },
      });
      if (error) return json({ ok: false, error: error.message });
      await admin.from("profiles").update({ role, name }).eq("id", data.user.id);
      return json({ ok: true, id: data.user.id });
    }

    if (action === "delete") {
      const email = String(body.email || "").trim().toLowerCase();
      const { data: p } = await admin.from("profiles").select("id").eq("email", email).single();
      if (!p) return json({ ok: false, error: "El usuario no existe" });
      if (p.id === user.id) return json({ ok: false, error: "No puedes quitarte el acceso a ti mismo" });
      const { error } = await admin.auth.admin.deleteUser(p.id);
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true });
    }

    return json({ ok: false, error: "Acción no válida" });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
