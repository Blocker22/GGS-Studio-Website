import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logAudit } from "./audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Not authenticated." }, 401);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, full_name")
    .eq("id", userData.user.id)
    .single();
  if (!callerProfile || !["staff", "admin"].includes(callerProfile.role)) {
    return json({ error: "Staff access required." }, 403);
  }
  const actor = {
    id: userData.user.id,
    role: callerProfile.role,
    label: callerProfile.full_name || userData.user.email || userData.user.id,
  };

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const { booking_id, amount } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);

  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, total_price")
    .eq("id", booking_id)
    .single();
  if (bookingErr || !booking) return json({ error: "Booking not found." }, 404);

  const { data: existingPayments } = await admin
    .from("payments")
    .select("amount, status")
    .eq("booking_id", booking_id)
    .in("status", ["succeeded", "partially_refunded"]);
  const alreadyPaid = (existingPayments ?? []).reduce((s, p) => s + Number(p.amount), 0);
  const remaining = Math.max(0, Number(booking.total_price) - alreadyPaid);

  const payAmount = typeof amount === "number" && amount > 0 ? amount : remaining;
  if (payAmount <= 0) return json({ error: "This booking is already fully paid." }, 400);

  const { data: payment, error: insertErr } = await admin
    .from("payments")
    .insert({
      booking_id,
      type: payAmount >= remaining ? "full" : "deposit",
      amount: payAmount,
      currency: "php",
      status: "succeeded",
      method: "cash",
    })
    .select()
    .single();
  if (insertErr) return json({ error: "Could not record payment.", detail: insertErr.message }, 400);

  await logAudit(admin, actor, "payment.mark_paid", "payment", payment.id, {
    booking_id,
    amount: payAmount,
    type: payment.type,
  });

  return json({ payment });
});
