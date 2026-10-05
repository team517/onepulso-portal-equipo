// Edge Function: devuelve los pagos de Stripe (solo para el admin/team@).
// Lee las suscripciones activas (mensualidades) y las últimas facturas.
// Necesita el secreto STRIPE_SECRET_KEY (clave secreta de Stripe, sk_...).
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

    // Solo un admin autenticado (team@)
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: "No autenticado" });
    const admin = createClient(url, service);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", user.id).single();
    if (!prof || prof.role !== "admin") return json({ ok: false, error: "Solo el administrador" });

    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) return json({ ok: true, configured: false });

    const sApi = async (path: string) => {
      const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: `Bearer ${key}` } });
      return await r.json();
    };

    const subsRes = await sApi("subscriptions?status=active&limit=100&expand[]=data.customer");
    if (subsRes?.error) return json({ ok: false, configured: true, error: subsRes.error.message || "Error de Stripe" });
    // deno-lint-ignore no-explicit-any
    const subscriptions = (subsRes.data || []).map((s: any) => {
      const it = s.items?.data?.[0];
      const price = it?.price;
      const cust = s.customer;
      return {
        id: s.id,
        customer: (cust && (cust.name || cust.email)) || "—",
        email: cust?.email || null,
        amount: price ? (price.unit_amount || 0) / 100 : 0,
        currency: (price?.currency || "eur").toUpperCase(),
        interval: price?.recurring?.interval || "month",
        next: s.current_period_end ? new Date(s.current_period_end * 1000).toISOString().slice(0, 10) : null,
        status: s.status,
      };
    });

    const invRes = await sApi("invoices?limit=20");
    // deno-lint-ignore no-explicit-any
    const invoices = (invRes?.data || []).map((i: any) => ({
      id: i.id,
      customer: i.customer_name || i.customer_email || "—",
      amount: ((i.status === "paid" ? i.amount_paid : i.amount_due) || 0) / 100,
      currency: (i.currency || "eur").toUpperCase(),
      status: i.status,
      date: i.created ? new Date(i.created * 1000).toISOString().slice(0, 10) : null,
      url: i.hosted_invoice_url || null,
    }));

    return json({ ok: true, configured: true, subscriptions, invoices });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
