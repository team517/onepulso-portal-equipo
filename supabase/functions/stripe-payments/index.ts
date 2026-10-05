// Edge Function: devuelve los pagos de Stripe (solo para el admin/team@).
// Lee las suscripciones activas (mensualidades) y las últimas facturas.
// Necesita el secreto STRIPE_SECRET_KEY (clave secreta de Stripe, sk_...).
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const day = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Solo team@onepulso.online
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ ok: false, error: "No autenticado" });
    if ((user.email || "").toLowerCase() !== "team@onepulso.online") return json({ ok: false, error: "Solo team@onepulso.online" });

    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) return json({ ok: true, configured: false });

    const sApi = async (path: string) => {
      const r = await fetch("https://api.stripe.com/v1/" + path, { headers: { Authorization: `Bearer ${key}` } });
      return await r.json();
    };

    const subsRes = await sApi("subscriptions?status=active&limit=100&expand[]=data.customer&expand[]=data.latest_invoice");
    if (subsRes?.error) return json({ ok: false, configured: true, error: subsRes.error.message || "Error de Stripe" });
    // deno-lint-ignore no-explicit-any
    const subscriptions = (subsRes.data || []).map((s: any) => {
      const it = s.items?.data?.[0];
      const price = it?.price;
      const cust = s.customer;
      const inv = s.latest_invoice;
      const paid = inv ? (inv.paid === true || inv.status === "paid") : (s.status === "active" || s.status === "trialing");
      const paidAt = inv?.status_transitions?.paid_at;
      // En las versiones nuevas de la API el periodo va en el item, no en la suscripción
      const periodEnd = s.current_period_end || it?.current_period_end;
      return {
        id: s.id,
        customer: (cust && (cust.name || cust.email)) || "—",
        email: cust?.email || null,
        amount: price ? (price.unit_amount || 0) / 100 : 0,
        currency: (price?.currency || "eur").toUpperCase(),
        interval: price?.recurring?.interval || "month",
        next: periodEnd ? day(periodEnd) : null,
        start: day(s.start_date || s.created),
        status: s.status,
        paid,
        paid_date: paidAt ? day(paidAt) : null,
      };
    });

    // Facturas de los últimos 13 meses (para ver los cobros mes a mes)
    const since = Math.floor(Date.now() / 1000) - 400 * 86400;
    // deno-lint-ignore no-explicit-any
    let raw: any[] = [], after = "";
    for (let page = 0; page < 5; page++) {
      const r = await sApi(`invoices?limit=100&created[gte]=${since}${after ? "&starting_after=" + after : ""}`);
      if (r?.error) break;
      raw = raw.concat(r.data || []);
      if (!r.has_more || !r.data?.length) break;
      after = r.data[r.data.length - 1].id;
    }
    const invoices = raw
      // deno-lint-ignore no-explicit-any
      .filter((i: any) => i.status !== "draft" && i.status !== "void")
      // deno-lint-ignore no-explicit-any
      .map((i: any) => ({
        id: i.id,
        subscription: (typeof i.subscription === "string" ? i.subscription : i.subscription?.id) ||
          i.parent?.subscription_details?.subscription || null,
        customer: i.customer_name || i.customer_email || "—",
        amount: ((i.status === "paid" ? i.amount_paid : i.amount_due) || 0) / 100,
        currency: (i.currency || "eur").toUpperCase(),
        status: i.status,
        date: i.created ? day(i.created) : null,
        paid_date: i.status_transitions?.paid_at ? day(i.status_transitions.paid_at) : null,
        url: i.hosted_invoice_url || null,
      }));

    return json({ ok: true, configured: true, subscriptions, invoices });
  } catch (e) {
    return json({ ok: false, error: String(e) });
  }
});
