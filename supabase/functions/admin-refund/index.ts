import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { logAudit } from "./audit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAYMONGO_API = "https://api.paymongo.com/v1";

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
  const { payment_id, amount, reason } = body ?? {};
  if (typeof payment_id !== "string") return json({ error: "payment_id is required." }, 400);

  const { data: payment, error: fetchErr } = await admin
    .from("payments")
    .select("*")
    .eq("id", payment_id)
    .single();
  if (fetchErr || !payment) return json({ error: "Payment not found." }, 404);

  const refundAmount = typeof amount === "number" ? amount : Number(payment.amount) - Number(payment.refunded_amount);
  if (refundAmount <= 0) return json({ error: "Nothing left to refund." }, 400);
  if (refundAmount > Number(payment.amount) - Number(payment.refunded_amount)) {
    return json({ error: "Refund exceeds what is left on this payment." }, 400);
  }

  let paymongoData: unknown = null;

  if (payment.method === "cash" || !payment.paymongo_payment_id) {
    // Cash has nothing to reverse online — just record that the studio handed
    // the money back. Same for an online payment that never reached "paid".
    if (payment.method !== "cash" && payment.status !== "succeeded") {
      return json({ error: "That online payment never completed, so there is nothing to refund." }, 400);
    }
  } else {
    const paymongoKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!paymongoKey) return json({ error: "PayMongo is not configured on this project yet." }, 400);

    const res = await fetch(PAYMONGO_API + "/refunds", {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(paymongoKey + ":"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount: Math.round(refundAmount * 100),
            payment_id: payment.paymongo_payment_id,
            reason: typeof reason === "string" && reason ? reason : "requested_by_customer",
          },
        },
      }),
    });
    paymongoData = await res.json();
    if (!res.ok) {
      return json({ error: "PayMongo refund failed.", detail: (paymongoData as any)?.errors?.[0]?.detail ?? paymongoData }, 400);
    }
  }

  const newRefundedTotal = Number(payment.refunded_amount) + refundAmount;
  const newStatus = newRefundedTotal >= Number(payment.amount) ? "refunded" : "partially_refunded";

  const { data: updated, error: updateErr } = await admin
    .from("payments")
    .update({ refunded_amount: newRefundedTotal, status: newStatus, updated_at: new Date().toISOString() })
    .eq("id", payment_id)
    .select()
    .single();
  if (updateErr) return json({ error: "Refund succeeded but failed to record locally.", detail: updateErr.message }, 500);

  await logAudit(admin, actor, "payment.refund", "payment", payment_id, {
    booking_id: payment.booking_id,
    amount: refundAmount,
    method: payment.method,
    new_status: newStatus,
    reason: typeof reason === "string" ? reason : null,
  });

  return json({ payment: updated, paymongo_refund: paymongoData });
});
