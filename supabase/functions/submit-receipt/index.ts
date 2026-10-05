import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { adminClient, corsHeaders, json, ownsBooking, resolveCaller } from "../_shared/guest.ts";
import { recordReceipt } from "../_shared/receipts.ts";

// A customer's proof of a manual QR transfer: the receipt image they uploaded
// into their own folder of the private payment-receipts bucket, plus the
// reference number off it. The payment moves to 'submitted' for staff to
// verify; nothing here marks anything paid.

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

  const { booking_id, receipt_path, reference_no, channel } = body ?? {};
  if (typeof booking_id !== "string") return json({ error: "booking_id is required." }, 400);
  if (typeof receipt_path !== "string" || !receipt_path.trim()) {
    return json({ error: "Please attach a photo or PDF of your payment receipt." }, 400);
  }

  // The upload must live in the caller's own folder: <user id>/… when signed
  // in, guest/<device id>/… for a guest browser.
  const expectedPrefix = caller.userId ? `${caller.userId}/` : `guest/${caller.deviceId}/`;
  if (!receipt_path.trim().startsWith(expectedPrefix)) {
    return json({ error: "That receipt upload does not belong to you." }, 403);
  }

  const { data: booking } = await admin.from("bookings").select("id, customer_id, device_id").eq("id", booking_id).single();
  if (!booking) return json({ error: "Booking not found." }, 404);
  if (!ownsBooking(booking, caller)) return json({ error: "That booking is not yours." }, 403);

  const res = await recordReceipt(admin, booking_id, {
    path: receipt_path,
    reference: typeof reference_no === "string" ? reference_no : "",
    channel: String(channel ?? ""),
  });
  if (res.error) return json({ error: res.error }, res.status ?? 400);
  return json({ payment: res.payment });
});
