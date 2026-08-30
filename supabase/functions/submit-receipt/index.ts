import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, ownsBooking, resolveCaller } from "./guest.ts";

// Attaches a customer's proof-of-transfer to the manual payment opened by
// create-booking. Payments are not writable by customers under RLS on purpose —
// everything about the money is set here, server-side, from an authority we
// verified: a signed-in session, or the device handshake behind a guest booking.

const CHANNELS = ["gcash", "bpi", "gotyme"];
const RECEIPT_BUCKET = "payment-receipts";

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

  const { booking_id, receipt_path, reference_no, channel } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);
  if (typeof receipt_path !== "string" || !receipt_path.trim()) {
    return json({ error: "Please attach a photo or PDF of your payment receipt." }, 400);
  }
  if (!CHANNELS.includes(channel)) {
    return json({ error: "Please choose which QR you paid to." }, 400);
  }
  const reference = typeof reference_no === "string" ? reference_no.trim() : "";
  if (!reference) {
    return json({ error: "Please enter the reference number shown on your receipt." }, 400);
  }
  if (reference.length > 64) {
    return json({ error: "That reference number is too long." }, 400);
  }

  // The upload must genuinely live in the caller's own folder, and exist.
  // Anything else is either a mistake or an attempt to point the studio at
  // somebody else's file. Signed-in customers own <user id>/…; a guest browser
  // owns guest/<device id>/….
  const path = receipt_path.trim();
  const expectedPrefix = caller.userId ? `${caller.userId}/` : `guest/${caller.deviceId}/`;
  if (!path.startsWith(expectedPrefix)) {
    return json({ error: "That receipt upload does not belong to you." }, 403);
  }
  const slash = path.lastIndexOf("/");
  const fileName = path.slice(slash + 1);
  const { data: listed } = await admin.storage
    .from(RECEIPT_BUCKET)
    .list(path.slice(0, slash), { search: fileName });
  if (!listed || !listed.some((f) => f.name === fileName)) {
    return json({ error: "We could not find your uploaded receipt. Please attach it again." }, 400);
  }

  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("id, customer_id, device_id, status")
    .eq("id", booking_id)
    .single();
  if (bookingErr || !booking) return json({ error: "Booking not found." }, 404);
  if (!ownsBooking(booking, caller)) {
    return json({ error: "That booking is not yours." }, 403);
  }
  if (booking.status === "cancelled") {
    return json({ error: "That booking was cancelled — nothing left to pay." }, 400);
  }

  const { data: payment, error: paymentErr } = await admin
    .from("payments")
    .select("id, status, receipt_path")
    .eq("booking_id", booking_id)
    .eq("method", "manual")
    .single();
  if (paymentErr || !payment) {
    return json({ error: "This booking has no online payment to settle." }, 404);
  }
  if (payment.status === "succeeded") {
    return json({ error: "This payment has already been verified — nothing more to send." }, 400);
  }
  if (payment.status === "refunded" || payment.status === "partially_refunded") {
    return json({ error: "This payment was refunded. Please contact the studio." }, 400);
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateErr } = await admin
    .from("payments")
    .update({
      status: "submitted",
      receipt_path: path,
      reference_no: reference,
      channel,
      submitted_at: now,
      rejection_reason: null,
      updated_at: now,
    })
    .eq("id", payment.id)
    .select()
    .single();
  if (updateErr) {
    return json({ error: "Could not record your receipt.", detail: updateErr.message }, 400);
  }

  // A replacement receipt supersedes the old one — drop it rather than leaving
  // an unreferenced copy of someone's bank screenshot sitting in storage.
  if (payment.receipt_path && payment.receipt_path !== path) {
    await admin.storage.from(RECEIPT_BUCKET).remove([payment.receipt_path]);
  }

  return json({ payment: updated });
});
