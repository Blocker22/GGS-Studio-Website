import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { loadBookingEmail, sendBookingEmail } from "../_shared/email.ts";
import { logAudit } from "../_shared/audit.ts";

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
  const { booking_id, force, notify } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);

  const { data: booking, error: fetchErr } = await admin
    .from("bookings")
    .select("*, booking_services(quantity, price_at_booking, services(name)), payments(id, amount, status, method, receipt_path)")
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

  // Gathered before the delete; afterwards there is no row left to describe.
  const mail = notify === true ? await loadBookingEmail(admin, booking_id) : null;
  if (mail) await sendBookingEmail(admin, booking_id, "cancelled_staff", { mail, by: { id: actor.id, name: actor.label } });

  // The private files go with the booking: receipts and the ID photo.
  const receipts = (booking.payments ?? []).map((p: { receipt_path: string | null }) => p.receipt_path).filter(Boolean) as string[];
  if (receipts.length) await admin.storage.from("payment-receipts").remove(receipts);
  if (booking.id_image_path) await admin.storage.from("customer-ids").remove([booking.id_image_path]);
  await admin.from("payments").delete().eq("booking_id", booking_id);
  await admin.from("booking_services").delete().eq("booking_id", booking_id);

  const { error: deleteErr } = await admin.from("bookings").delete().eq("id", booking_id);
  if (deleteErr) return json({ error: "Could not delete booking.", detail: deleteErr.message }, 400);

  await logAudit(admin, actor, "booking.delete", "booking", booking_id, {
    summary: `Deleted the booking of ${booking.guest_name || booking.guest_email || "a customer"}`,
    snapshot: booking,
    unrefunded_amount: unrefunded,
    forced: Boolean(force) && unrefunded > 0,
    emailed: Boolean(mail),
  });

  return json({ deleted: true, booking_id });
});
