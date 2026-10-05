import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, ownsBooking, resolveCaller } from "../_shared/guest.ts";
import { logAudit } from "../_shared/audit.ts";
import { notifyStaff, sendBookingEmail } from "../_shared/email.ts";
import { background, loadRules, staffName, UNIT_MS } from "../_shared/booking-core.ts";

// Cancels a booking for whoever owns it: a signed-in customer, or the browser
// that placed it (device handshake in guest.ts). Customers can cancel only
// until the cutoff; after that only staff can. Staff cancellations with a
// reason, alternatives and a choice of whether to email go through admin-api;
// this endpoint stays for the customer side and simple staff calls.

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = adminClient();

  // deno-lint-ignore no-explicit-any
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

  const { data: existing } = await admin.from("bookings").select("*").eq("id", booking_id).single();
  if (!existing) return json({ error: "Booking not found." }, 404);
  if (!ownsBooking(existing, caller)) return json({ error: "Not your booking." }, 403);
  if (existing.status === "cancelled") return json({ error: "This booking is already cancelled." }, 400);

  const rules = await loadRules(admin);
  const withinCutoff = new Date(existing.start_at).getTime() - Date.now() < rules.cutoffHours * UNIT_MS;
  if (!caller.isStaff) {
    if (!["pending", "confirmed"].includes(existing.status)) return json({ error: "This booking can no longer be cancelled online." }, 400);
    if (withinCutoff) {
      return json({ error: `Online cancellation closes ${rules.cutoffHours} hours before the session. Please call the studio.` }, 400);
    }
  }

  const name = caller.isStaff ? await staffName(admin, caller.userId) : null;
  const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null;
  const { data: updated, error: updateErr } = await admin
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: caller.isStaff ? (name || "staff") : "customer",
      cancellation_reason: cleanReason,
      updated_by: caller.userId,
    })
    .eq("id", booking_id)
    .select()
    .single();
  if (updateErr) return json({ error: "Could not cancel the booking.", detail: updateErr.message }, 400);

  await logAudit(
    admin,
    {
      id: caller.userId,
      role: caller.isStaff ? "staff" : caller.userId ? "customer" : "guest",
      label: caller.isStaff ? (name || "staff") : existing.guest_name ? `${existing.guest_name} <${existing.guest_email ?? "no email"}>` : (caller.email ?? "customer"),
    },
    "booking.status",
    "booking",
    booking_id,
    { summary: `Cancelled by ${caller.isStaff ? name || "staff" : "the customer"}`, reason: cleanReason, changes: [{ field: "status", from: existing.status, to: "cancelled" }] },
  );

  const by = { id: caller.userId, name: caller.isStaff ? name : "customer" };
  if (caller.isStaff) {
    background(sendBookingEmail(admin, booking_id, "cancelled_staff", { by, extra: { reason_note: cleanReason ? `Reason: ${cleanReason}` : "" } }));
  } else {
    background((async () => {
      await sendBookingEmail(admin, booking_id, "cancelled_customer", { by });
      await notifyStaff(admin, booking_id, "staff_cancelled");
    })());
  }

  return json({ booking: updated });
});
