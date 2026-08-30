import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, ownsBooking, resolveCaller } from "./guest.ts";

// Cancels a booking for whoever owns it — a signed-in customer, studio staff,
// or the anonymous browser that placed it, proven by the device handshake in
// guest.ts. Ownership and the cutoff window are both decided here from the row
// in the database, never from the request.

async function refundPaymentIntent(stripeKey: string, paymentIntentId: string, amountPesos?: number) {
  const params = new URLSearchParams({ payment_intent: paymentIntentId });
  if (amountPesos != null) params.set("amount", String(Math.round(amountPesos * 100)));
  const res = await fetch("https://api.stripe.com/v1/refunds", {
    method: "POST",
    headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  return { ok: res.ok, data: await res.json() };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = adminClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const resolved = await resolveCaller(admin, req, body ?? {});
  if ("error" in resolved) return resolved.error;
  const caller = resolved.caller;

  const { booking_id, reason } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);

  const { data: existing, error: fetchErr } = await admin
    .from("bookings")
    .select("*")
    .eq("id", booking_id)
    .single();
  if (fetchErr || !existing) return json({ error: "Booking not found." }, 404);
  if (!ownsBooking(existing, caller)) return json({ error: "Not your booking." }, 403);
  if (existing.status === "cancelled") return json({ error: "Booking is already cancelled." }, 400);

  const { data: cutoffSetting } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "reschedule_cutoff_hours")
    .single();
  const cutoffHours = Number(cutoffSetting?.value ?? 24);
  const withinCutoff = new Date(existing.start_at).getTime() - Date.now() < cutoffHours * 3600000;

  if (!caller.isStaff && withinCutoff) {
    return json({ error: `Cancellations must be made at least ${cutoffHours} hours in advance. Contact the studio directly.` }, 400);
  }

  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: typeof reason === "string" ? reason : null,
    })
    .eq("id", booking_id)
    .select()
    .single();
  if (updateErr) return json({ error: "Could not cancel booking.", detail: updateErr.message }, 400);

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  let refundResult: unknown = null;
  if (stripeKey && !withinCutoff) {
    const { data: payment } = await admin
      .from("payments")
      .select("*")
      .eq("booking_id", booking_id)
      .eq("status", "succeeded")
      .maybeSingle();
    if (payment?.stripe_payment_intent_id) {
      const { ok, data } = await refundPaymentIntent(stripeKey, payment.stripe_payment_intent_id);
      if (ok) {
        await admin
          .from("payments")
          .update({ status: "refunded", refunded_amount: payment.amount })
          .eq("id", payment.id);
        refundResult = data;
      }
    }
  }

  return json({ booking: updated, refund: refundResult });
});
