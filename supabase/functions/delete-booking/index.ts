import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bookingCancelledEmail, loadBookingEmail, sendEmail } from "./email.ts";
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

function peso(n: number): string {
  return "₱" + Math.round(n).toLocaleString("en-PH");
}

// Staff-only, permanent removal of a booking (and, via ON DELETE CASCADE, its
// booking_services and payments rows) — distinct from cancel-booking, which
// only flips status to "cancelled" and leaves the record in place for the
// customer's history. This is for cleaning up test/duplicate/mistaken
// entries, not the everyday cancellation path.
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
  const { booking_id, force } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select("id, guest_name, guest_email, customer_id, start_at, total_price")
    .eq("id", booking_id)
    .single();
  if (fetchErr || !booking) return json({ error: "Booking not found." }, 404);

  // Money that was actually taken and never refunded shouldn't vanish along
  // with the booking record that explains it — send the admin through
  // admin-refund first, unless they explicitly confirm they want to skip that.
  const { data: payments } = await admin
    .from("payments")
    .select("amount, refunded_amount, status")
    .eq("booking_id", booking_id);
  const unrefunded = (payments || [])
    .filter((p) => ["succeeded", "partially_refunded"].includes(p.status))
    .reduce((sum, p) => sum + (Number(p.amount) - Number(p.refunded_amount)), 0);

  if (unrefunded > 0 && !force) {
    return json({
      error: `This booking has ${peso(unrefunded)} unrefunded — refund it first, or delete anyway to write it off.`,
      unrefunded_amount: unrefunded,
    }, 409);
  }

  // Gathered before the delete — afterwards there is no row left to describe.
  const mail = await loadBookingEmail(admin, booking_id);

  const { error: deleteErr } = await admin.from("bookings").delete().eq("id", booking_id);
  if (deleteErr) return json({ error: "Could not delete booking.", detail: deleteErr.message }, 400);

  await logAudit(admin, actor, "booking.delete", "booking", booking_id, {
    guest_name: booking.guest_name,
    guest_email: booking.guest_email,
    customer_id: booking.customer_id,
    start_at: booking.start_at,
    total_price: booking.total_price,
    unrefunded_amount: unrefunded,
    forced: Boolean(force) && unrefunded > 0,
  });

  // From the customer's side a deleted booking is a cancelled one.
  if (mail) {
    const { subject, html } = bookingCancelledEmail(mail.to, mail.booking, { byStudio: true });
    await sendEmail(mail.to, subject, html);
  }

  return json({ deleted: true, booking_id });
});
