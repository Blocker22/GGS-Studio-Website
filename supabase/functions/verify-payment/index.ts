import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { loadBookingEmail, paymentRejectedEmail, paymentReceiptEmail, sendEmail } from "./email.ts";
import { logAudit } from "./audit.ts";

// Staff decision on a manual QR transfer: approve it (the money really landed
// in the studio's account) or reject it with a reason so the customer can send
// a corrected receipt. Approving confirms the booking.

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

  const { payment_id, approve, reason, amount } = body ?? {};
  if (typeof payment_id !== "string") return json({ error: "payment_id is required." }, 400);
  if (typeof approve !== "boolean") return json({ error: "approve must be true or false." }, 400);

  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .select("id, booking_id, status, amount, method")
    .eq("id", payment_id)
    .single();
  if (paymentErr || !payment) return json({ error: "Payment not found." }, 404);
  if (payment.method !== "manual") {
    return json({ error: "Only manual QR transfers are verified by hand." }, 400);
  }
  if (payment.status === "succeeded") {
    return json({ error: "That payment is already verified." }, 400);
  }
  if (payment.status === "pending") {
    return json({ error: "The customer has not sent a receipt for this payment yet." }, 400);
  }

  const now = new Date().toISOString();

  if (!approve) {
    const { data: rejected, error: rejectErr } = await admin
      .from("payments")
      .update({
        status: "rejected",
        rejection_reason: typeof reason === "string" && reason.trim() ? reason.trim() : "Receipt could not be verified.",
        verified_at: now,
        verified_by: userData.user.id,
        updated_at: now,
      })
      .eq("id", payment.id)
      .select()
      .single();
    if (rejectErr) return json({ error: "Could not reject that payment.", detail: rejectErr.message }, 400);

    await logAudit(admin, actor, "payment.reject", "payment", payment.id, {
      booking_id: payment.booking_id,
      amount: payment.amount,
      reason: rejected.rejection_reason,
    });

    const rejectMail = await loadBookingEmail(admin, payment.booking_id);
    if (rejectMail) {
      const { subject, html } = paymentRejectedEmail(rejectMail.to, rejectMail.booking, rejected.rejection_reason);
      await sendEmail(rejectMail.to, subject, html);
    }

    return json({ payment: rejected });
  }

  // Staff can correct the amount at approval time — what the customer actually
  // transferred is what the receipt says, not what the form asked for.
  const settledAmount = typeof amount === "number" && amount > 0 ? amount : Number(payment.amount);

  const { data: approved, error: approveErr } = await admin
    .from("payments")
    .update({
      status: "succeeded",
      amount: settledAmount,
      verified_at: now,
      verified_by: userData.user.id,
      rejection_reason: null,
      updated_at: now,
    })
    .eq("id", payment.id)
    .select()
    .single();
  if (approveErr) return json({ error: "Could not verify that payment.", detail: approveErr.message }, 400);

  // Money is in, so the slot stops being provisional.
  const { data: booking } = await admin
    .from("bookings")
    .select("id, status")
    .eq("id", payment.booking_id)
    .single();
  const wasPending = booking?.status === "pending";
  if (wasPending) {
    await admin.from("bookings").update({ status: "confirmed", updated_at: now }).eq("id", booking!.id);
  }

  await logAudit(admin, actor, "payment.verify", "payment", payment.id, {
    booking_id: payment.booking_id,
    amount: settledAmount,
    booking_confirmed: wasPending,
  });

  const mail = await loadBookingEmail(admin, payment.booking_id);
  if (mail) {
    // What's left after this transfer, so a downpayment says so plainly.
    const { data: settled } = await admin
      .from("payments")
      .select("amount")
      .eq("booking_id", payment.booking_id)
      .in("status", ["succeeded", "partially_refunded"]);
    const paid = (settled ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
    const { subject, html } = paymentReceiptEmail(mail.to, mail.booking, {
      amount: settledAmount,
      method: "manual",
      type: approved.type,
      balance: Math.max(0, Number(mail.booking.totalPrice ?? 0) - paid),
    });
    await sendEmail(mail.to, subject, html);
  }

  return json({ payment: approved, booking_confirmed: wasPending });
});
